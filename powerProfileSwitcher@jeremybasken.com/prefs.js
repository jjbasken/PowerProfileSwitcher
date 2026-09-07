/* prefs.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

// Keep in sync with extension.js. Ordered from most to least power saving.
const PROFILE_ORDER = ['power-saver', 'balanced', 'performance'];

const POWER_PROFILES_SERVICES = [
    {
        busName: 'org.freedesktop.UPower.PowerProfiles',
        objectPath: '/org/freedesktop/UPower/PowerProfiles',
        interfaceName: 'org.freedesktop.UPower.PowerProfiles',
    },
    {
        busName: 'net.hadess.PowerProfiles',
        objectPath: '/net/hadess/PowerProfiles',
        interfaceName: 'net.hadess.PowerProfiles',
    },
];

// The preferences window must not hang if the daemon is unresponsive.
const DAEMON_QUERY_TIMEOUT_MS = 2000;

export default class PowerProfileSwitcherPreferences extends ExtensionPreferences {
    async fillPreferencesWindow(window) {
        const settings = this.getSettings();
        // Tie the settings object's lifetime to the window so it is not
        // collected while the rows are still connected to it.
        window._settings = settings;

        const profiles = await this._queryAvailableProfiles();
        const labels = {
            'power-saver': _('Power Saver'),
            'balanced': _('Balanced'),
            'performance': _('Performance'),
        };

        const page = new Adw.PreferencesPage();

        const group = new Adw.PreferencesGroup({
            title: _('Power Profiles'),
            description: _('Profiles this machine does not support are not listed.'),
        });
        group.add(this._buildProfileRow({
            title: _('AC Profile'),
            subtitle: _('Profile to use when plugged in'),
            settings,
            key: 'ac-profile',
            profiles,
            labels,
        }));
        group.add(this._buildProfileRow({
            title: _('Battery Profile'),
            subtitle: _('Profile to use when on battery'),
            settings,
            key: 'battery-profile',
            profiles,
            labels,
        }));
        page.add(group);

        const manualGroup = new Adw.PreferencesGroup({
            title: _('Manual Changes'),
            description: _('Changing your profile by hand is remembered for that power state and reused the next time you return to it. Changing a profile above forgets the matching manual choice.'),
        });
        manualGroup.add(this._buildManualRow({
            title: _('Remembered on AC'),
            settings,
            key: 'ac-manual-profile',
            labels,
        }));
        manualGroup.add(this._buildManualRow({
            title: _('Remembered on Battery'),
            settings,
            key: 'battery-manual-profile',
            labels,
        }));
        page.add(manualGroup);

        window.add(page);
    }

    /**
     * Build a combo row bound to one of the profile preferences.
     *
     * @param {object} options - row options
     * @param {string} options.title - row title
     * @param {string} options.subtitle - row subtitle
     * @param {Gio.Settings} options.settings - the extension settings
     * @param {string} options.key - the settings key to bind
     * @param {string[]} options.profiles - selectable profile names
     * @param {object} options.labels - profile name to display label
     * @returns {Adw.ComboRow} the configured row
     */
    _buildProfileRow({title, subtitle, settings, key, profiles, labels}) {
        const row = new Adw.ComboRow({title, subtitle});
        row.model = new Gtk.StringList({
            strings: profiles.map(profile => labels[profile] ?? profile),
        });

        // Show what will actually be used: if the stored profile is not
        // offered by this machine, the extension substitutes the nearest one.
        const stored = settings.get_string(key);
        const index = profiles.indexOf(stored);
        row.selected = index >= 0
            ? index : Math.max(0, profiles.indexOf(nearestProfile(stored, profiles)));

        row.connect('notify::selected', () => {
            const selected = row.selected;
            if (selected === Gtk.INVALID_LIST_POSITION || selected >= profiles.length)
                return;

            settings.set_string(key, profiles[selected]);
        });

        return row;
    }

    /**
     * Build a row showing a remembered manual profile, with a way to clear it.
     *
     * @param {object} options - row options
     * @param {string} options.title - row title
     * @param {Gio.Settings} options.settings - the extension settings
     * @param {string} options.key - the settings key holding the choice
     * @param {object} options.labels - profile name to display label
     * @returns {Adw.ActionRow} the configured row
     */
    _buildManualRow({title, settings, key, labels}) {
        const row = new Adw.ActionRow({title});
        const button = new Gtk.Button({
            label: _('Forget'),
            valign: Gtk.Align.CENTER,
        });
        row.add_suffix(button);
        row.activatable_widget = button;

        const sync = () => {
            const profile = settings.get_string(key);
            row.subtitle = profile
                ? (labels[profile] ?? profile)
                : _('None — using the configured profile');
            button.sensitive = profile !== '';
        };

        const changedId = settings.connect(`changed::${key}`, sync);
        row.connect('destroy', () => settings.disconnect(changedId));
        button.connect('clicked', () => settings.set_string(key, ''));
        sync();

        return row;
    }

    /**
     * Ask power-profiles-daemon which profiles this machine offers.
     *
     * Falls back to the full list if the daemon cannot be reached, so the
     * preferences window still works without it.
     *
     * @returns {Promise<string[]>} available profile names
     */
    async _queryAvailableProfiles() {
        for (const service of POWER_PROFILES_SERVICES) {
            try {
                const reply = await this._getProperty(service, 'Profiles');
                const [wrapped] = reply.deepUnpack();
                const profiles = wrapped.recursiveUnpack()
                    .map(entry => entry['Profile'])
                    .filter(name => typeof name === 'string');

                if (profiles.length > 0)
                    return profiles;
            } catch {
                // Try the next bus name, then fall back to the full list.
            }
        }

        return [...PROFILE_ORDER];
    }

    /**
     * Read a single D-Bus property from a power-profiles-daemon bus name.
     *
     * @param {object} service - the service descriptor
     * @param {string} property - the property name
     * @returns {Promise<GLib.Variant>} the reply variant
     */
    _getProperty(service, property) {
        return new Promise((resolve, reject) => {
            Gio.DBus.system.call(
                service.busName, service.objectPath,
                'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', [service.interfaceName, property]),
                new GLib.VariantType('(v)'),
                Gio.DBusCallFlags.NONE, DAEMON_QUERY_TIMEOUT_MS, null,
                (connection, result) => {
                    try {
                        resolve(connection.call_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }
}

/**
 * Pick the available profile closest to the requested one.
 *
 * @param {string} profile - the requested profile name
 * @param {string[]} available - profiles this machine offers
 * @returns {string} the nearest available profile
 */
function nearestProfile(profile, available) {
    const wanted = PROFILE_ORDER.indexOf(profile);
    if (wanted < 0)
        return available[0];

    let nearest = available[0];
    let nearestDistance = Infinity;
    for (const candidate of available) {
        const index = PROFILE_ORDER.indexOf(candidate);
        if (index < 0)
            continue;

        const distance = Math.abs(index - wanted);
        if (distance < nearestDistance) {
            nearestDistance = distance;
            nearest = candidate;
        }
    }

    return nearest;
}

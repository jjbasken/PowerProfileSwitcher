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
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const PROFILES = [
    {label: 'Power Saver', value: 'power-saver'},
    {label: 'Balanced', value: 'balanced'},
    {label: 'Performance', value: 'performance'},
];

export default class PowerProfileSwitcherPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage();
        const group = new Adw.PreferencesGroup({title: 'Power Profiles'});
        page.add(group);

        const acRow = this._buildProfileRow(
            'AC Profile',
            'Profile to use when plugged in',
            settings,
            'ac-profile'
        );
        const batteryRow = this._buildProfileRow(
            'Battery Profile',
            'Profile to use when on battery',
            settings,
            'battery-profile'
        );

        group.add(acRow);
        group.add(batteryRow);
        window.add(page);
    }

    _buildProfileRow(title, subtitle, settings, key) {
        const row = new Adw.ComboRow({title, subtitle});
        row.model = new Gtk.StringList({strings: PROFILES.map(p => p.label)});

        const current = settings.get_string(key);
        row.selected = Math.max(0, PROFILES.findIndex(p => p.value === current));

        row.connect('notify::selected', () => {
            settings.set_string(key, PROFILES[row.selected].value);
        });

        return row;
    }
}

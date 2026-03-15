/* extension.js
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 2 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 *
 * SPDX-License-Identifier: GPL-2.0-or-later
 */
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UPOWER_BUS_NAME = 'org.freedesktop.UPower';
const UPOWER_OBJECT_PATH = '/org/freedesktop/UPower';
const UPOWER_INTERFACE = 'org.freedesktop.UPower';

const POWER_PROFILES_BUS_NAME = 'net.hadess.PowerProfiles';
const POWER_PROFILES_OBJECT_PATH = '/net/hadess/PowerProfiles';
const POWER_PROFILES_INTERFACE = 'net.hadess.PowerProfiles';

export default class PowerProfileSwitcherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._settingsChangedId = this._settings.connect('changed', () => {
            // User explicitly changed preferences — clear overrides and apply
            this._acManualOverride = false;
            this._batteryManualOverride = false;
            this._applyProfile();
        });

        // Per-state override flags: set when user manually changes the profile
        // while in that power state. Cleared when the extension skips a switch
        // (one-time skip) or when the user updates preferences.
        this._acManualOverride = false;
        this._batteryManualOverride = false;

        // The profile value we most recently sent to the daemon, used to
        // distinguish our own DBus writes from external (manual) changes.
        this._pendingProfile = null;

        this._upowerProxy = null;
        this._powerProfilesProxy = null;
        this._upowerSignalId = null;
        this._powerProfilesSignalId = null;

        this._initProxies();
    }

    disable() {
        if (this._settingsChangedId && this._settings) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = null;
        }
        this._settings = null;

        if (this._upowerSignalId && this._upowerProxy) {
            this._upowerProxy.disconnect(this._upowerSignalId);
            this._upowerSignalId = null;
        }

        if (this._powerProfilesSignalId && this._powerProfilesProxy) {
            this._powerProfilesProxy.disconnect(this._powerProfilesSignalId);
            this._powerProfilesSignalId = null;
        }

        this._upowerProxy = null;
        this._powerProfilesProxy = null;
        this._pendingProfile = null;
    }

    _initProxies() {
        const UPowerProxyWrapper = Gio.DBusProxy.makeProxyWrapper(`
            <node>
                <interface name="${UPOWER_INTERFACE}">
                    <property name="OnBattery" type="b" access="read"/>
                </interface>
            </node>
        `);

        const PowerProfilesProxyWrapper = Gio.DBusProxy.makeProxyWrapper(`
            <node>
                <interface name="${POWER_PROFILES_INTERFACE}">
                    <property name="ActiveProfile" type="s" access="readwrite"/>
                </interface>
            </node>
        `);

        try {
            this._upowerProxy = new UPowerProxyWrapper(
                Gio.DBus.system,
                UPOWER_BUS_NAME,
                UPOWER_OBJECT_PATH
            );

            this._powerProfilesProxy = new PowerProfilesProxyWrapper(
                Gio.DBus.system,
                POWER_PROFILES_BUS_NAME,
                POWER_PROFILES_OBJECT_PATH
            );

            this._upowerSignalId = this._upowerProxy.connect(
                'g-properties-changed',
                this._onPowerStateChanged.bind(this)
            );

            this._powerProfilesSignalId = this._powerProfilesProxy.connect(
                'g-properties-changed',
                this._onActiveProfileChanged.bind(this)
            );

            // Set initial profile — no override check on first run
            this._applyProfile();
        } catch (e) {
            console.error(`[PowerProfileSwitcher] Failed to initialize: ${e.message}`);
        }
    }

    _onPowerStateChanged(proxy, changed, invalidated) {
        if (!changed.lookup_value('OnBattery', null))
            return;

        const onBattery = this._upowerProxy.OnBattery;

        // Check if the user manually overrode the profile for the state we're
        // entering. If so, skip this one automatic switch and clear the flag so
        // the next transition behaves normally.
        if (onBattery && this._batteryManualOverride) {
            this._batteryManualOverride = false;
            console.log('[PowerProfileSwitcher] Skipping switch to battery profile — manual override active');
            return;
        }
        if (!onBattery && this._acManualOverride) {
            this._acManualOverride = false;
            console.log('[PowerProfileSwitcher] Skipping switch to AC profile — manual override active');
            return;
        }

        this._applyProfile();
    }

    _onActiveProfileChanged(proxy, changed, invalidated) {
        const variant = changed.lookup_value('ActiveProfile', null);
        if (!variant)
            return;

        const newProfile = variant.unpack();

        // If this matches what we just set, it's our own write — ignore it.
        if (newProfile === this._pendingProfile) {
            this._pendingProfile = null;
            return;
        }

        // External change: the user (or another tool) manually picked a profile.
        const onBattery = this._upowerProxy?.OnBattery;
        if (onBattery)
            this._batteryManualOverride = true;
        else
            this._acManualOverride = true;

        console.log(`[PowerProfileSwitcher] Manual override detected: ${newProfile} (on battery: ${onBattery})`);
    }

    _applyProfile() {
        try {
            const onBattery = this._upowerProxy.OnBattery;
            const targetProfile = onBattery
                ? this._settings.get_string('battery-profile')
                : this._settings.get_string('ac-profile');
            const currentProfile = this._powerProfilesProxy.ActiveProfile;

            if (currentProfile !== targetProfile) {
                this._pendingProfile = targetProfile;
                this._powerProfilesProxy.ActiveProfile = targetProfile;
                console.log(`[PowerProfileSwitcher] Switched to ${targetProfile} (on battery: ${onBattery})`);
            }
        } catch (e) {
            console.error(`[PowerProfileSwitcher] Failed to update profile: ${e.message}`);
        }
    }
}

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

const PROFILE_ON_BATTERY = 'power-saver';
const PROFILE_ON_AC = 'performance';

export default class PowerProfileSwitcherExtension extends Extension {
    enable() {
        this._upowerProxy = null;
        this._powerProfilesProxy = null;
        this._upowerSignalId = null;

        this._initProxies();
    }

    disable() {
        if (this._upowerSignalId && this._upowerProxy) {
            this._upowerProxy.disconnect(this._upowerSignalId);
            this._upowerSignalId = null;
        }

        this._upowerProxy = null;
        this._powerProfilesProxy = null;
    }

    _initProxies() {
        // Create UPower proxy
        const UPowerProxyWrapper = Gio.DBusProxy.makeProxyWrapper(`
            <node>
                <interface name="${UPOWER_INTERFACE}">
                    <property name="OnBattery" type="b" access="read"/>
                </interface>
            </node>
        `);

        // Create PowerProfiles proxy
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

            // Connect to property changes
            this._upowerSignalId = this._upowerProxy.connect(
                'g-properties-changed',
                this._onPowerStateChanged.bind(this)
            );

            // Set initial profile based on current state
            this._updatePowerProfile();
        } catch (e) {
            console.error(`[PowerProfileSwitcher] Failed to initialize: ${e.message}`);
        }
    }

    _onPowerStateChanged(proxy, changed, invalidated) {
        if (changed.lookup_value('OnBattery', null)) {
            this._updatePowerProfile();
        }
    }

    _updatePowerProfile() {
        try {
            const onBattery = this._upowerProxy.OnBattery;
            const targetProfile = onBattery ? PROFILE_ON_BATTERY : PROFILE_ON_AC;
            const currentProfile = this._powerProfilesProxy.ActiveProfile;

            if (currentProfile !== targetProfile) {
                this._powerProfilesProxy.ActiveProfile = targetProfile;
                console.log(`[PowerProfileSwitcher] Switched to ${targetProfile} (on battery: ${onBattery})`);
            }
        } catch (e) {
            console.error(`[PowerProfileSwitcher] Failed to update profile: ${e.message}`);
        }
    }
}

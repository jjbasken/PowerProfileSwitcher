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
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const UPOWER_BUS_NAME = 'org.freedesktop.UPower';
const UPOWER_OBJECT_PATH = '/org/freedesktop/UPower';
const UPOWER_INTERFACE = 'org.freedesktop.UPower';

// power-profiles-daemon moved to a freedesktop-namespaced bus name in 0.20;
// net.hadess.PowerProfiles is deprecated and slated for removal, so prefer the
// new name and fall back to the old one on older daemons.
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

const LOGIN1_BUS_NAME = 'org.freedesktop.login1';
const LOGIN1_OBJECT_PATH = '/org/freedesktop/login1';
const LOGIN1_MANAGER_INTERFACE = 'org.freedesktop.login1.Manager';

// Ordered from most to least power saving. Used to pick the nearest available
// profile when this machine does not offer the configured one.
const PROFILE_ORDER = ['power-saver', 'balanced', 'performance'];

// How long to keep attributing an ActiveProfile change to our own write. If
// the daemon never echoes the value back (because it rejected or overrode the
// write), we must stop suppressing, or the user's next manual change to that
// same profile would be silently ignored.
const PENDING_PROFILE_TIMEOUT_MS = 5000;

const UPowerProxy = Gio.DBusProxy.makeProxyWrapper(`
<node>
    <interface name="${UPOWER_INTERFACE}">
        <property name="OnBattery" type="b" access="read"/>
    </interface>
</node>
`);

/**
 * Build a proxy wrapper for one of the power-profiles-daemon bus names.
 *
 * @param {string} interfaceName - the D-Bus interface to introspect
 * @returns {Function} a proxy wrapper constructor
 */
function makePowerProfilesProxy(interfaceName) {
    return Gio.DBusProxy.makeProxyWrapper(`
    <node>
        <interface name="${interfaceName}">
            <property name="ActiveProfile" type="s" access="readwrite"/>
            <property name="Profiles" type="aa{sv}" access="read"/>
            <property name="ActiveProfileHolds" type="aa{sv}" access="read"/>
        </interface>
    </node>
    `);
}

/**
 * Unwrap a value that may still be boxed in a GLib.Variant.
 *
 * Property getters on a proxy deepUnpack(), which leaves the values of an
 * a{sv} dictionary as variants.
 *
 * @param {*} value - a plain value or a GLib.Variant
 * @returns {*} the unboxed value
 */
function unbox(value) {
    return value instanceof GLib.Variant ? value.unpack() : value;
}

/**
 * Whether an error is a cancellation from our own teardown.
 *
 * @param {Error} error - the error to test
 * @returns {boolean} true if the operation was cancelled
 */
function isCancelled(error) {
    return error instanceof GLib.Error &&
        error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED);
}

export default class PowerProfileSwitcherExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._cancellable = new Gio.Cancellable();

        this._upowerProxy = null;
        this._powerProfilesProxy = null;
        this._powerProfilesInterface = null;

        this._upowerSignalId = 0;
        this._powerProfilesSignalId = 0;
        this._sleepSignalId = 0;
        this._settingsChangedIds = [];

        // The profile we most recently asked the daemon for, used to tell our
        // own writes apart from external ones. Cleared on the first
        // ActiveProfile change that follows, or by timeout.
        this._pendingProfile = null;
        this._pendingTimeoutId = 0;

        // Editing a state's preferred profile is an explicit decision, so it
        // supersedes any manual choice remembered for that state.
        this._settingsChangedIds.push(
            this._settings.connect('changed::ac-profile', () => {
                this._settings.set_string('ac-manual-profile', '');
                this._applyProfile();
            }),
            this._settings.connect('changed::battery-profile', () => {
                this._settings.set_string('battery-manual-profile', '');
                this._applyProfile();
            })
        );

        this._setUp().catch(error => {
            if (isCancelled(error))
                return;
            console.error(`[PowerProfileSwitcher] Failed to initialize: ${error.message}`);
        });
    }

    disable() {
        // Cancel first: in-flight proxy setup and property writes must not
        // land on a half-torn-down extension.
        this._cancellable?.cancel();
        this._cancellable = null;

        this._clearPendingProfile();

        for (const id of this._settingsChangedIds)
            this._settings?.disconnect(id);
        this._settingsChangedIds = [];
        this._settings = null;

        if (this._upowerSignalId) {
            this._upowerProxy?.disconnect(this._upowerSignalId);
            this._upowerSignalId = 0;
        }

        if (this._powerProfilesSignalId) {
            this._powerProfilesProxy?.disconnect(this._powerProfilesSignalId);
            this._powerProfilesSignalId = 0;
        }

        if (this._sleepSignalId) {
            Gio.DBus.system.signal_unsubscribe(this._sleepSignalId);
            this._sleepSignalId = 0;
        }

        this._upowerProxy = null;
        this._powerProfilesProxy = null;
        this._powerProfilesInterface = null;
    }

    async _setUp() {
        const cancellable = this._cancellable;

        const upowerProxy = await UPowerProxy.newAsync(
            Gio.DBus.system, UPOWER_BUS_NAME, UPOWER_OBJECT_PATH, cancellable);

        const powerProfiles = await this._connectPowerProfiles(cancellable);

        // disable() may have run while we were awaiting.
        if (cancellable.is_cancelled())
            return;

        this._upowerProxy = upowerProxy;
        this._powerProfilesProxy = powerProfiles.proxy;
        this._powerProfilesInterface = powerProfiles.interfaceName;

        this._upowerSignalId = this._upowerProxy.connect(
            'g-properties-changed', this._onPowerStateChanged.bind(this));

        this._powerProfilesSignalId = this._powerProfilesProxy.connect(
            'g-properties-changed', this._onActiveProfileChanged.bind(this));

        // Firmware can reset the platform profile across a suspend cycle, so
        // reassert ours on resume.
        this._sleepSignalId = Gio.DBus.system.signal_subscribe(
            LOGIN1_BUS_NAME, LOGIN1_MANAGER_INTERFACE, 'PrepareForSleep',
            LOGIN1_OBJECT_PATH, null, Gio.DBusSignalFlags.NONE,
            (connection, sender, path, iface, signal, params) => {
                const [aboutToSleep] = params.deepUnpack();
                if (!aboutToSleep)
                    this._applyProfile();
            });

        this._applyProfile();
    }

    /**
     * Connect to whichever power-profiles-daemon bus name this system offers.
     *
     * @param {Gio.Cancellable} cancellable - cancellable for the connection
     * @returns {Promise<{proxy: Gio.DBusProxy, interfaceName: string}>} the proxy
     */
    async _connectPowerProfiles(cancellable) {
        const usableNames = await this._usableBusNames(cancellable);

        for (const service of POWER_PROFILES_SERVICES) {
            if (!usableNames.has(service.busName))
                continue;

            const wrapper = makePowerProfilesProxy(service.interfaceName);
            const proxy = await wrapper.newAsync(
                Gio.DBus.system, service.busName, service.objectPath, cancellable);

            return {proxy, interfaceName: service.interfaceName};
        }

        throw new Error(
            'power-profiles-daemon is not available on the system bus ' +
            `(looked for ${POWER_PROFILES_SERVICES.map(s => s.busName).join(', ')})`);
    }

    /**
     * Names that are currently owned or can be activated on the system bus.
     *
     * @param {Gio.Cancellable} cancellable - cancellable for the calls
     * @returns {Promise<Set<string>>} the set of usable bus names
     */
    async _usableBusNames(cancellable) {
        const listNames = async method => {
            const reply = await new Promise((resolve, reject) => {
                Gio.DBus.system.call(
                    'org.freedesktop.DBus', '/org/freedesktop/DBus',
                    'org.freedesktop.DBus', method, null, new GLib.VariantType('(as)'),
                    Gio.DBusCallFlags.NONE, -1, cancellable,
                    (connection, result) => {
                        try {
                            resolve(connection.call_finish(result));
                        } catch (error) {
                            reject(error);
                        }
                    });
            });
            const [names] = reply.deepUnpack();
            return names;
        };

        const [owned, activatable] = await Promise.all([
            listNames('ListNames'),
            listNames('ListActivatableNames'),
        ]);

        return new Set([...owned, ...activatable]);
    }

    _onPowerStateChanged(proxy, changed, invalidated) {
        if (!changed.lookup_value('OnBattery', null) && !invalidated.includes('OnBattery'))
            return;

        this._applyProfile();
    }

    _onActiveProfileChanged(proxy, changed, invalidated) {
        const variant = changed.lookup_value('ActiveProfile', null);
        if (!variant && !invalidated.includes('ActiveProfile'))
            return;

        const newProfile = variant ? variant.unpack() : this._powerProfilesProxy?.ActiveProfile;
        if (!newProfile)
            return;

        // Clear unconditionally. A write the daemon rejected or overrode must
        // not leave a stale pending value behind that swallows a later manual
        // change to that same profile.
        const wasOurWrite = newProfile === this._pendingProfile;
        this._clearPendingProfile();
        if (wasOurWrite)
            return;

        // A profile hold (GNOME's low-battery power saver, a game, a browser)
        // also moves ActiveProfile. That is not the user picking a profile, so
        // it must not be remembered as one.
        if (this._hasActiveProfileHolds()) {
            console.debug(`[PowerProfileSwitcher] Ignoring held profile ${newProfile}`);
            return;
        }

        const onBattery = this._upowerProxy?.OnBattery;
        if (typeof onBattery !== 'boolean') {
            console.debug('[PowerProfileSwitcher] Power state unknown, not remembering manual change');
            return;
        }

        const state = onBattery ? 'battery' : 'ac';
        // Matching the configured preference is not an override; storing it
        // would just add state that behaves identically.
        const remembered = newProfile === this._settings.get_string(`${state}-profile`)
            ? '' : newProfile;
        this._settings.set_string(`${state}-manual-profile`, remembered);

        console.log(`[PowerProfileSwitcher] Remembered manual profile ${newProfile} for ${state}`);
    }

    _applyProfile() {
        if (!this._upowerProxy || !this._powerProfilesProxy)
            return;

        const onBattery = this._upowerProxy.OnBattery;
        if (typeof onBattery !== 'boolean')
            return;

        const target = this._targetProfile(onBattery);
        if (!target)
            return;

        // The cached ActiveProfile only ever comes from the daemon, so it is
        // safe to use as a "nothing to do" check.
        if (this._powerProfilesProxy.ActiveProfile === target)
            return;

        this._setActiveProfile(target, onBattery);
    }

    /**
     * The profile that should be active for a power state.
     *
     * @param {boolean} onBattery - whether the machine is on battery
     * @returns {?string} the profile name, or null if none can be resolved
     */
    _targetProfile(onBattery) {
        const state = onBattery ? 'battery' : 'ac';
        const remembered = this._settings.get_string(`${state}-manual-profile`);
        const preferred = this._settings.get_string(`${state}-profile`);

        return this._nearestAvailableProfile(remembered || preferred);
    }

    /**
     * Resolve a profile name against what the daemon actually offers.
     *
     * Not every machine exposes all three profiles, and asking for a missing
     * one fails, so substitute the closest available alternative.
     *
     * @param {string} profile - the desired profile name
     * @returns {?string} an available profile name, or null if none is known
     */
    _nearestAvailableProfile(profile) {
        const available = this._availableProfiles();
        if (available.length === 0 || available.includes(profile))
            return profile || null;

        const wanted = PROFILE_ORDER.indexOf(profile);
        if (wanted < 0)
            return available[0];

        let nearest = null;
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

        if (nearest)
            console.debug(`[PowerProfileSwitcher] ${profile} unavailable, using ${nearest}`);

        return nearest ?? available[0];
    }

    /**
     * Profile names offered by the daemon.
     *
     * @returns {string[]} the available profile names
     */
    _availableProfiles() {
        const profiles = this._powerProfilesProxy?.Profiles ?? [];

        return profiles
            .map(entry => unbox(entry['Profile']))
            .filter(name => typeof name === 'string');
    }

    /**
     * Whether another client is currently holding a profile.
     *
     * @returns {boolean} true if a hold is active
     */
    _hasActiveProfileHolds() {
        const holds = this._powerProfilesProxy?.ActiveProfileHolds;

        return Array.isArray(holds) && holds.length > 0;
    }

    /**
     * Ask the daemon to switch profiles.
     *
     * Written as an explicit Properties.Set rather than through the proxy's
     * property setter: that setter updates the local cache before the call
     * completes and only logs failures, so a rejected write would leave the
     * cache claiming success and wedge every later switch.
     *
     * @param {string} profile - the profile to activate
     * @param {boolean} onBattery - whether the machine is on battery
     */
    _setActiveProfile(profile, onBattery) {
        this._pendingProfile = profile;
        this._armPendingProfileTimeout();

        this._powerProfilesProxy.call(
            'org.freedesktop.DBus.Properties.Set',
            new GLib.Variant('(ssv)', [
                this._powerProfilesInterface,
                'ActiveProfile',
                new GLib.Variant('s', profile),
            ]),
            Gio.DBusCallFlags.NONE, -1, this._cancellable,
            (proxy, result) => {
                try {
                    proxy.call_finish(result);
                    console.log(`[PowerProfileSwitcher] Switched to ${profile} (on battery: ${onBattery})`);
                } catch (error) {
                    if (isCancelled(error))
                        return;

                    this._clearPendingProfile();
                    console.error(`[PowerProfileSwitcher] Failed to switch to ${profile}: ${error.message}`);
                }
            });
    }

    _armPendingProfileTimeout() {
        if (this._pendingTimeoutId)
            GLib.Source.remove(this._pendingTimeoutId);

        this._pendingTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT, PENDING_PROFILE_TIMEOUT_MS, () => {
                this._pendingTimeoutId = 0;
                this._pendingProfile = null;
                return GLib.SOURCE_REMOVE;
            });
    }

    _clearPendingProfile() {
        if (this._pendingTimeoutId) {
            GLib.Source.remove(this._pendingTimeoutId);
            this._pendingTimeoutId = 0;
        }
        this._pendingProfile = null;
    }
}

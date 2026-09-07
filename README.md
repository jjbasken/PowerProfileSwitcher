# PowerProfileSwitcher

A GNOME Shell extension that automatically switches power profiles based on whether your laptop is plugged in or running on battery.

## Features

- Automatically applies your preferred power profile when AC power is connected or disconnected
- Configurable profiles for AC and battery states (Power Saver, Balanced, Performance)
- Remembers profiles you set by hand: change your profile manually and that choice is reused the next time you return to that power state
- Only offers profiles your machine actually supports, and substitutes the nearest available one if a configured profile is missing
- Leaves profile *holds* alone, so it does not fight GNOME's low-battery power saver or an app that has requested performance
- Reapplies your profile after resume, since firmware can reset the platform profile across suspend
- Preferences UI accessible from GNOME Extensions app

## Requirements

- GNOME Shell 48 or 49
- `power-profiles-daemon` installed and running

Either D-Bus name works: `org.freedesktop.UPower.PowerProfiles` (daemon 0.20+) is preferred, with a fallback to the deprecated `net.hadess.PowerProfiles`.

## Installation

### From source

```bash
git clone https://github.com/jjbasken/PowerProfileSwitcher.git
cd PowerProfileSwitcher
bash install.sh
gnome-extensions enable powerProfileSwitcher@jeremybasken.com
```

The install script copies the extension files and compiles the GSettings schema. It replaces any existing install rather than merging into it.

### Reload GNOME Shell

- **X11:** Press <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, press <kbd>Enter</kbd>.
- **Wayland:** Log out and back in.

To reload just this extension without restarting the shell:

```bash
gnome-extensions disable powerProfileSwitcher@jeremybasken.com
gnome-extensions enable powerProfileSwitcher@jeremybasken.com
```

## Configuration

Open the extension preferences via the GNOME Extensions app or:

```bash
gnome-extensions prefs powerProfileSwitcher@jeremybasken.com
```

| Setting | Description | Default |
|---|---|---|
| AC Profile | Profile to use when plugged in | `performance` |
| Battery Profile | Profile to use when on battery | `power-saver` |

Available profiles: **Power Saver**, **Balanced**, **Performance**. The preferences window lists only the profiles your hardware reports, so machines that do not expose `performance` will not offer it.

The preferences window also shows the manual choice currently remembered for each power state, with a **Forget** button to clear it.

## How It Works

The extension watches the `OnBattery` property on `org.freedesktop.UPower` and sets `ActiveProfile` on power-profiles-daemon when it changes.

If you change your power profile by hand (via GNOME Settings, the quick settings menu, or another tool), the extension remembers that choice for the power state you were in and reuses it the next time you return to that state. It clears when you change that state's profile in preferences, or with the **Forget** button.

Changes that come from a profile *hold* — GNOME's automatic low-battery power saver, or an application asking for performance — are not treated as manual choices and are not remembered.

Remembered choices are stored in GSettings, so they survive locking the screen, logging out, and rebooting.

## Logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep PowerProfileSwitcher
```

`console.debug` messages (unavailable-profile substitutions, ignored holds) need debug logging enabled:

```bash
G_MESSAGES_DEBUG=all journalctl -f -o cat /usr/bin/gnome-shell | grep PowerProfileSwitcher
```

## License

GPL-3.0 — see [LICENSE](LICENSE)

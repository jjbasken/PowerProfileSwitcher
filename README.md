# PowerProfileSwitcher

A GNOME Shell extension that automatically switches power profiles based on whether your laptop is plugged in or running on battery.

## Features

- Automatically applies your preferred power profile when AC power is connected or disconnected
- Configurable profiles for AC and battery states (Power Saver, Balanced, Performance)
- Respects manual overrides: if you manually change your profile, the extension skips its next automatic switch for that state, then resumes normal behavior
- Preferences UI accessible from GNOME Extensions app

## Requirements

- GNOME Shell 48 or 49
- `power-profiles-daemon` installed and running (`net.hadess.PowerProfiles` DBus service)

## Installation

### From source

```bash
git clone https://github.com/jeremybasken/PowerProfileSwitcher.git
cd PowerProfileSwitcher
bash install.sh
gnome-extensions enable powerProfileSwitcher@jeremybasken.com
```

The install script copies the extension files and compiles the GSettings schema.

### Reload GNOME Shell

- **X11:** Run the following command:
  ```bash
  busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting…")'
  ```
- **Wayland:** Log out and back in.

## Configuration

Open the extension preferences via the GNOME Extensions app or:

```bash
gnome-extensions prefs powerProfileSwitcher@jeremybasken.com
```

| Setting | Description | Default |
|---|---|---|
| AC Profile | Profile to use when plugged in | `performance` |
| Battery Profile | Profile to use when on battery | `power-saver` |

Available profiles: **Power Saver**, **Balanced**, **Performance**

## How It Works

The extension monitors the `org.freedesktop.UPower` DBus interface for changes to the `OnBattery` property. When power state changes, it sets `ActiveProfile` on the `net.hadess.PowerProfiles` DBus interface.

If you manually change your power profile (via GNOME Settings or another tool), the extension detects the external change and skips its next automatic switch for that power state. The override clears on the following power state transition or when you update preferences.

## Logs

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep PowerProfileSwitcher
```

## License

GPL-3.0 — see [LICENSE](LICENSE)

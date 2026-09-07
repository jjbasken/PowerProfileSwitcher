# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GNOME Shell extension that automatically switches power profiles based on AC/battery state. It supports GNOME Shell 48 and 49.

The extension itself lives in the `powerProfileSwitcher@jeremybasken.com/` subdirectory. The repository root holds only `install.sh`, docs, and the license — do not copy the repo root into the extensions directory.

## Development Commands

Install/update extension locally (copies the extension subdirectory and compiles the schema):

```bash
bash install.sh
```

Restart GNOME Shell:

- **X11:** <kbd>Alt</kbd>+<kbd>F2</kbd>, type `r`, <kbd>Enter</kbd>. The `org.gnome.Shell.Eval` D-Bus method does *not* work for this — it has been gated behind unsafe mode since GNOME 41 and silently returns `(false, "")`.
- **Wayland:** Log out and back in.

Reload just the extension, without restarting the shell:

```bash
gnome-extensions disable powerProfileSwitcher@jeremybasken.com
gnome-extensions enable powerProfileSwitcher@jeremybasken.com
```

View extension logs:

```bash
journalctl -f -o cat /usr/bin/gnome-shell | grep PowerProfileSwitcher
```

Recompile the schema after editing the gschema XML (the compiled file is committed):

```bash
glib-compile-schemas powerProfileSwitcher@jeremybasken.com/schemas/
```

## Architecture

- **extension.js**: Main entry point. Exports a default class extending `Extension` with `enable()` and `disable()`. No UI — it is a background D-Bus consumer.
- **prefs.js**: Preferences window, exports a default class extending `ExtensionPreferences`. Runs in a *separate process* from `extension.js`; the two share state only through GSettings.
- **metadata.json**: UUID, name, description, supported shell versions, `settings-schema`, and `session-modes`.
- **schemas/**: GSettings schema plus its committed `gschemas.compiled`.

## Conventions and Constraints

- `disable()` must release everything `enable()` acquired: signal handler IDs, D-Bus signal subscriptions, GLib timeout sources, and the `Gio.Cancellable`. Extensions are disabled and re-enabled repeatedly (including at screen lock, unless `session-modes` says otherwise), so `enable()` must not assume fresh process state.
- **Never do synchronous D-Bus in the shell process.** `new SomeProxyWrapper(bus, name, path)` without a callback calls `init()` synchronously and blocks the compositor. Use `Wrapper.newAsync(bus, name, path, cancellable)` and pass a cancellable that `disable()` cancels.
- **Do not use the GJS D-Bus property setter (`proxy.SomeProp = value`) for writes that can fail.** It calls `set_cached_property()` optimistically before the call completes and only `log()`s errors, so a rejected write leaves the cache reporting success and cannot be caught. Issue `org.freedesktop.DBus.Properties.Set` through `proxy.call()` with a completion callback instead.
- Property getters on a proxy `deepUnpack()`, which leaves `a{sv}` values boxed as `GLib.Variant`. Unbox them before use.
- State that must survive an enable/disable cycle belongs in GSettings, not instance fields.
- In `prefs.js`, do not call the module-level `gettext` at module scope: the extension is not registered until after the module is imported, and the lookup throws. Call it inside `fillPreferencesWindow()`, which may be `async`.

## Relevant APIs

- Battery state: `OnBattery` property on `org.freedesktop.UPower` at `/org/freedesktop/UPower`.
- Power profiles: `org.freedesktop.UPower.PowerProfiles` at `/org/freedesktop/UPower/PowerProfiles` (power-profiles-daemon 0.20+), falling back to the deprecated `net.hadess.PowerProfiles` at `/net/hadess/PowerProfiles`. Relevant properties: `ActiveProfile` (readwrite), `Profiles`, `ActiveProfileHolds`.
- Resume detection: `PrepareForSleep` signal on `org.freedesktop.login1.Manager`.

Not every machine offers all three profiles (`power-saver`, `balanced`, `performance`) — always resolve a configured profile against the daemon's `Profiles` list before setting it.

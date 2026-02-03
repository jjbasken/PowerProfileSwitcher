# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a GNOME Shell extension that automatically switches power profiles based on AC/battery state. It targets GNOME Shell version 49.

## Development Commands

Install/update extension locally:
```bash
cp -r . ~/.local/share/gnome-shell/extensions/powerProfileSwitcher@jeremybasken.com/
```

Restart GNOME Shell (X11 only):
```bash
busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Meta.restart("Restarting…")'
```

For Wayland, log out and back in to reload extensions.

View extension logs:
```bash
journalctl -f -o cat /usr/bin/gnome-shell
```

Enable/disable extension:
```bash
gnome-extensions enable powerProfileSwitcher@jeremybasken.com
gnome-extensions disable powerProfileSwitcher@jeremybasken.com
```

## Architecture

- **extension.js**: Main entry point. Must export a default class with `enable()` and `disable()` methods.
- **metadata.json**: Extension metadata including UUID, name, description, and supported GNOME Shell versions.
- **stylesheet.css**: Custom CSS styling for extension UI elements.

## GNOME Shell Extension Patterns

- Uses GObject for class registration (`GObject.registerClass`)
- Imports GNOME libraries via `gi://` protocol (e.g., `gi://GObject`)
- UI components extend from `QuickToggle` and `SystemIndicator` for quick settings panel integration
- Must clean up all resources in `disable()` to support extension reloading

## Relevant APIs

- Power profiles: `org.freedesktop.UPower` DBus interface for battery state
- Power profile daemon: `net.hadess.PowerProfiles` DBus interface for switching profiles

#!/usr/bin/env bash
set -euo pipefail

EXTENSION_UUID="powerProfileSwitcher@jeremybasken.com"
DEST="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

mkdir -p "$DEST"
cp -r "$EXTENSION_UUID/." "$DEST/"
glib-compile-schemas "$DEST/schemas/"

echo "Installed to $DEST"
echo "Run: gnome-extensions enable $EXTENSION_UUID"

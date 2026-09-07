#!/usr/bin/env bash
set -euo pipefail

# Work relative to the script, not the caller's directory.
cd "$(dirname "$(realpath "${BASH_SOURCE[0]}")")"

: "${HOME:?HOME is not set}"

EXTENSION_UUID="powerProfileSwitcher@jeremybasken.com"
DEST="$HOME/.local/share/gnome-shell/extensions/$EXTENSION_UUID"

if [[ ! -d "$EXTENSION_UUID" ]]; then
    echo "error: $EXTENSION_UUID/ not found next to this script" >&2
    exit 1
fi

if ! command -v glib-compile-schemas >/dev/null 2>&1; then
    echo "error: glib-compile-schemas not found." >&2
    echo "       Install libglib2.0-dev (Debian/Ubuntu) or glib2-devel (Fedora)." >&2
    exit 1
fi

# Replace rather than merge, so files dropped from the repo do not linger in
# an existing install.
rm -rf "$DEST"
mkdir -p "$DEST"
cp -r "$EXTENSION_UUID/." "$DEST/"
glib-compile-schemas "$DEST/schemas/"

echo "Installed to $DEST"
echo "Run: gnome-extensions enable $EXTENSION_UUID"
echo "Then log out and back in (Wayland), or press Alt+F2 and type 'r' (X11)."

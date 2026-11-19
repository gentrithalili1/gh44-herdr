#!/usr/bin/env bash
# Undoes install.sh: switches to Herdr's main layout and removes the gh44-herdr layout, the mods,
# Revive's hooks, the plugins in plugins.txt and the gh44 themes. Keys and settings go back to the
# newest .bak file install.sh kept, or to Herdr's defaults. The Herdr app must be open.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
LAYOUT=gh44-herdr
FALLBACK_LAYOUT=main

die() { echo "herdr: $*" >&2; exit 1; }

command -v herdr-app > /dev/null || die "herdr-app is not on PATH"
herdr-app status > /dev/null 2>&1 || die "open the Herdr app first"

# 1. Show Herdr's own layout, then remove ours.
herdr-app do layout.switch "{\"name\":\"$FALLBACK_LAYOUT\"}" > /dev/null
rm -f "$APP_HOME/layouts/$LAYOUT.json"
echo "layout: $FALLBACK_LAYOUT"

# 2. Plugins with their own installer.
awk '!/^[[:space:]]*#/ && NF { print $1 }' "$HERE/plugins.txt" | while read -r repo; do
  echo "plugin: removing $repo"
  curl -fsSL "https://raw.githubusercontent.com/$repo/main/install.sh" | sh -s -- --app --uninstall
done

# 3. Revive's hooks, before its folder goes.
if [ -f "$APP_HOME/mods/revive/revive.mjs" ] && command -v node > /dev/null; then
  node "$APP_HOME/mods/revive/revive.mjs" uninstall > /dev/null
  echo "revive: hooks removed"
fi

# 4. Mods: own ones only when they still link here, then gh44-files and mods.txt.
for mod in "$HERE"/mods/*/; do
  mod="${mod%/}" target="$APP_HOME/mods/$(basename "$mod")"
  [ -L "$target" ] && [ "$(readlink "$target")" = "$mod" ] && rm "$target"
done
rm -rf "$APP_HOME/mods/gh44-files"
awk '!/^[[:space:]]*#/ && NF { print $3 }' "$HERE/mods.txt" | while read -r name; do
  rm -rf "${APP_HOME:?}/mods/$name"
done
echo "mods: removed"

# 5. Keys and settings: the newest backup, or none for Herdr's defaults.
for name in keys.json settings.json; do
  backup=$(ls -t "$APP_HOME/$name".bak-* 2> /dev/null | head -1 || true)
  if [ -n "$backup" ]; then
    mv "$backup" "$APP_HOME/$name"
    echo "$name: restored $(basename "$backup")"
  else
    rm -f "$APP_HOME/$name"
    echo "$name: Herdr defaults"
  fi
done

# 6. Themes.
rm -f "$APP_HOME/themes/gh44-dark.json" "$APP_HOME/themes/gh44-light.json"
echo "herdr: uninstalled"

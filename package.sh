#!/usr/bin/env bash
# Build the Chrome and Firefox extension zips.
#   Chrome  -> rinaudo-extension-chrome.zip  (manifest.json: service_worker background)
#   Firefox -> rinaudo-extension-firefox.zip (manifest.firefox.json: event-page background + gecko id)
# The shared source (background.js, config.js, content/, popup/, vote/, icons/, privacy.html)
# is identical across both; only the manifest differs.
set -euo pipefail
cd "$(dirname "$0")"

SHARED=(background.js config.js content icons popup vote privacy.html welcome.html welcome.js)

build() {
  local manifest="$1" out="$2"
  local root dir
  root="$(pwd)"
  dir="$(mktemp -d)"
  cp -r "${SHARED[@]}" "$dir"/
  cp "$manifest" "$dir/manifest.json"
  rm -f "$root/$out"
  ( cd "$dir" && zip -rq "$root/$out" . )
  rm -rf "$dir"
  echo "built $out  (from $manifest)"
}

build manifest.json         rinaudo-extension-chrome.zip
build manifest.firefox.json rinaudo-extension-firefox.zip

# Drop the legacy single-target zip name to avoid confusion.
rm -f rinaudo-extension.zip

echo "done."

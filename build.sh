#!/usr/bin/env bash
# Release builder for the Mizkif Global browser extension.
#
#   ./build.sh                      run release checks, then build both zips in the repo root
#   ./build.sh --set-version V      set the version field in BOTH manifests, then exit (no build)
#   ./build.sh --publish            build, then stage the zips + version bump into the portal
#                                   (/opt/mizdaq-prod-staging/web). Does NOT build or restart
#                                   the portal and does NOT submit to any store.
#
# Every step is gated by scripts/release-checks.mjs. The hand-rolled process this
# replaces once let the manifests drift and shipped a build where the Instagram
# content scripts never loaded; the checks make that class of mistake a hard error.
#
# PORTAL_WEB can be overridden in the environment for testing --publish against a
# scratch copy of the portal tree.
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$(pwd)"

CHECKS="$ROOT/scripts/release-checks.mjs"
CHROME_ZIP="rinaudo-extension-chrome.zip"
FIREFOX_ZIP="rinaudo-extension-firefox.zip"
PORTAL_WEB="${PORTAL_WEB:-/opt/mizdaq-prod-staging/web}"

# The packaged file set. Must stay in lockstep with the lists at the top of
# scripts/release-checks.mjs. Layout matches the historical hand-built zips:
# shared files at zip root, manifest.json swapped per browser.
SHARED=(background.js config.js content icons popup vote privacy.html welcome.html welcome.js rates-list.js)

usage() {
  echo "usage: ./build.sh [--set-version X.Y.Z | --publish]"
  exit 2
}

# ---------------------------------------------------------------------------
# Arg parsing
# ---------------------------------------------------------------------------
MODE="build"
NEW_VERSION=""
if [[ $# -gt 0 ]]; then
  case "$1" in
    --set-version)
      [[ $# -eq 2 ]] || usage
      NEW_VERSION="$2"
      MODE="set-version"
      ;;
    --publish)
      [[ $# -eq 1 ]] || usage
      MODE="publish"
      ;;
    -h|--help) usage ;;
    *) echo "unknown argument: $1"; usage ;;
  esac
fi

# ---------------------------------------------------------------------------
# --set-version: bump both manifests and exit
# ---------------------------------------------------------------------------
if [[ "$MODE" == "set-version" ]]; then
  if [[ ! "$NEW_VERSION" =~ ^[0-9]+(\.[0-9]+){1,3}$ ]]; then
    echo "error: '$NEW_VERSION' is not a valid extension version (want dot separated numbers, e.g. 1.0.58)" >&2
    exit 1
  fi
  node -e '
    const fs = require("fs");
    const v = process.argv[1];
    for (const f of ["manifest.json", "manifest.firefox.json"]) {
      const src = fs.readFileSync(f, "utf8");
      JSON.parse(src); // refuse to touch a broken manifest
      const out = src.replace(/("version"\s*:\s*")[^"]+(")/, `$1${v}$2`);
      if (!out.includes(`"version": "${v}"`)) {
        console.error(`error: could not find the version field in ${f}`);
        process.exit(1);
      }
      fs.writeFileSync(f, out);
      const now = JSON.parse(out).version;
      console.log(`${f}: version is now ${now}`);
    }
  ' "$NEW_VERSION"
  echo "Version set. Run ./build.sh to produce the zips."
  exit 0
fi

# ---------------------------------------------------------------------------
# Pre-build release checks (manifests, syntax, dash policy, host coverage)
# ---------------------------------------------------------------------------
echo "== Release checks (source tree) =="
node "$CHECKS"
echo

VERSION="$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync("manifest.json","utf8")).version)')"

# ---------------------------------------------------------------------------
# Build both zips (same layout as the historical hand-built ones:
# everything at zip root, firefox manifest renamed to manifest.json)
# ---------------------------------------------------------------------------
build_zip() {
  local manifest="$1" out="$2"
  local dir
  dir="$(mktemp -d)"
  cp -r "${SHARED[@]}" "$dir"/
  cp "$manifest" "$dir/manifest.json"
  find "$dir" -name '.DS_Store' -delete
  rm -f "$ROOT/$out"
  ( cd "$dir" && zip -rq "$ROOT/$out" . )
  rm -rf "$dir"
  echo "built $out (from $manifest)"
}

echo "== Building v$VERSION =="
build_zip manifest.json         "$CHROME_ZIP"
build_zip manifest.firefox.json "$FIREFOX_ZIP"
echo

# ---------------------------------------------------------------------------
# Post-build checks inside the archives
# ---------------------------------------------------------------------------
echo "== Release checks (built zips) =="
node "$CHECKS" --zips "$CHROME_ZIP" "$FIREFOX_ZIP"
echo

# ---------------------------------------------------------------------------
# --publish: stage into the portal downloads + bump the downloads page VERSION
# ---------------------------------------------------------------------------
if [[ "$MODE" == "publish" ]]; then
  DL_DIR="$PORTAL_WEB/public/downloads"
  PAGE="$PORTAL_WEB/app/downloads/page.tsx"
  if [[ ! -d "$DL_DIR" || ! -f "$PAGE" ]]; then
    echo "error: portal tree not found at $PORTAL_WEB (need $DL_DIR and $PAGE)" >&2
    exit 1
  fi
  CHROME_OUT="$DL_DIR/mizkif-global-chrome-v$VERSION.zip"
  FIREFOX_OUT="$DL_DIR/mizkif-global-firefox-v$VERSION.xpi"
  cp "$CHROME_ZIP" "$CHROME_OUT"
  cp "$FIREFOX_ZIP" "$FIREFOX_OUT"
  chmod 644 "$CHROME_OUT" "$FIREFOX_OUT"
  echo "staged $CHROME_OUT"
  echo "staged $FIREFOX_OUT"

  node -e '
    const fs = require("fs");
    const [page, v] = process.argv.slice(1);
    const src = fs.readFileSync(page, "utf8");
    const out = src.replace(/const VERSION = '\''[^'\'']+'\'';/, `const VERSION = '\''${v}'\'';`);
    if (!out.includes(`const VERSION = '\''${v}'\'';`)) {
      console.error(`error: could not update the VERSION constant in ${page}`);
      process.exit(1);
    }
    fs.writeFileSync(page, out);
    console.log(`${page}: VERSION is now ${v}`);
  ' "$PAGE" "$VERSION"
  echo
  echo "############################################################"
  echo "##                                                        ##"
  echo "##  PUBLISH IS NOT FINISHED. OPERATOR ACTION REQUIRED:    ##"
  echo "##                                                        ##"
  echo "##  1. The portal still needs a BUILD and RESTART before  ##"
  echo "##     the new downloads page goes live (this script      ##"
  echo "##     never builds or restarts the portal).              ##"
  echo "##  2. The Chrome Web Store and Firefox AMO listings      ##"
  echo "##     still need a MANUAL SUBMISSION of the new zips.    ##"
  echo "##                                                        ##"
  echo "############################################################"
  echo
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
echo "== Summary =="
echo "version: $VERSION"
sha256sum "$CHROME_ZIP" "$FIREFOX_ZIP"
echo
echo "next steps:"
if [[ "$MODE" == "publish" ]]; then
  echo "  - build and restart the portal so the downloads page serves v$VERSION"
  echo "  - submit $CHROME_ZIP to the Chrome Web Store"
  echo "  - submit $FIREFOX_ZIP to Firefox AMO (it becomes the signed .xpi)"
else
  echo "  - ./build.sh --publish to stage the zips + version onto the portal downloads page"
  echo "  - submit $CHROME_ZIP to the Chrome Web Store"
  echo "  - submit $FIREFOX_ZIP to Firefox AMO (it becomes the signed .xpi)"
fi

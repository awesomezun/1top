#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Unnotarized preview distribution must be requested explicitly.
MODE="${1:---notarized}"
[[ "$MODE" == --preview || "$MODE" == --notarized ]] || {
  echo 'Usage: package-macos.sh [--preview|--notarized] [versioned.app]' >&2; exit 1;
}
PYTHON="${ONETOP_PYTHON:-python3}"
VERSION="$(PYTHONPATH=agent "$PYTHON" -c 'from onetop import __version__; print(__version__)')"
APP="${2:-build/1top_v${VERSION}/1top.app}"
OUT="${ONETOP_RELEASE_ROOT:-release/v${VERSION}}/1top-${VERSION}-macos-arm64.dmg"
[[ -d "$APP/Contents" ]] || { echo "Build the macOS app first: $APP" >&2; exit 1; }
APP_VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")"
[[ "$APP_VERSION" == "$VERSION" ]] || { echo 'App and source versions do not match.' >&2; exit 1; }
[[ ! -e "$OUT" ]] || { echo "Preserve existing release: $OUT" >&2; exit 1; }
codesign --verify --deep --strict "$APP"
if [[ "$MODE" == --notarized ]]; then
  : "${ONETOP_DEVELOPER_ID:?Set a Developer ID Application identity from your Keychain}"
  : "${ONETOP_NOTARY_PROFILE:?Set the notarytool Keychain profile name}"
  [[ "$ONETOP_DEVELOPER_ID" == 'Developer ID Application:'* ]] || { echo 'Developer ID Application required.' >&2; exit 1; }
  codesign -dv "$APP" 2>&1 | /usr/bin/grep -q '^Authority=Developer ID Application:'
  xcrun stapler validate "$APP"
  spctl --assess --type execute --verbose=2 "$APP"
fi
mkdir -p "$(dirname "$OUT")" build
STAGE="$(mktemp -d "$PWD/build/dmg-${VERSION}.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
ditto "$APP" "$STAGE/1top.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname '1top' -srcfolder "$STAGE" -format UDZO "$OUT"
hdiutil verify "$OUT"
if [[ "$MODE" == --notarized ]]; then
  codesign --force --timestamp --sign "$ONETOP_DEVELOPER_ID" "$OUT"
  xcrun notarytool submit "$OUT" --keychain-profile "$ONETOP_NOTARY_PROFILE" --wait
  xcrun stapler staple "$OUT"
  xcrun stapler validate "$OUT"
  spctl --assess --type open --context context:primary-signature --verbose=2 "$OUT"
else
  echo 'PREVIEW: Developer ID signing and Apple notarization are not complete.'
fi
shasum -a 256 "$OUT"

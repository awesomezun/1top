#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
VERSION="$(.venv/bin/python -c 'from onetop import __version__; print(__version__)')"
APP="build/1top_v${VERSION}/1top.app"
STAGE="build/dmg_v${VERSION}"
OUT="release/v${VERSION}/1top-${VERSION}-macos-arm64.dmg"
[[ -d "$APP" ]] || { echo "Build the macOS app first" >&2; exit 1; }
[[ ! -e "$OUT" ]] || { echo "Preserve existing release: $OUT" >&2; exit 1; }
mkdir -p "$STAGE" "release/v${VERSION}"
ditto "$APP" "$STAGE/1top.app"
ln -s /Applications "$STAGE/Applications"
hdiutil create -volname '1top' -srcfolder "$STAGE" -ov -format UDZO "$OUT"
hdiutil verify "$OUT"
shasum -a 256 "$OUT"

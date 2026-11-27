#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
BACKEND="${ONETOP_AGENT_BACKEND:-rust}"
if [[ "$BACKEND" == "rust" ]]; then
  cargo build --manifest-path rust/Cargo.toml -p onetop-agent --release
  VERSION="$(rust/target/release/onetop-agent version)"
  BUILD_NUMBER="${ONETOP_BUILD_NUMBER:-$(awk -F'=' '/__build__/ {gsub(/[^0-9]/,"",$2); print $2}' agent/onetop/__init__.py)}"
else
  PYTHON="${ONETOP_PYTHON:-.venv/bin/python}"
  VERSION="$("$PYTHON" -c 'from onetop import __version__; print(__version__)')"
  BUILD_NUMBER="$("$PYTHON" -c 'from onetop import __build__; print(__build__)')"
fi
APP="${ONETOP_BUILD_ROOT:-build/1top_v${VERSION}}/1top.app"
if [[ -e "$APP" ]]; then echo "Versioned build already exists: $APP" >&2; exit 1; fi
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/agent"
if [[ "$BACKEND" == "rust" ]]; then
  cp rust/target/release/onetop-agent "$APP/Contents/Resources/agent/onetop-agent"
  cp -R agent/onetop/dist "$APP/Contents/Resources/agent/dist"
else
  "$PYTHON" -m PyInstaller --noconfirm --clean --name onetop-agent --onedir --collect-data onetop --collect-data certifi --copy-metadata opentelemetry-proto --copy-metadata protobuf --distpath build/agent-dist --workpath build/pyinstaller --specpath build scripts/agent_entry.py
  cp -R build/agent-dist/onetop-agent/. "$APP/Contents/Resources/agent/"
fi
SWIFT_SDK="${ONETOP_MACOS_SDK:-$(xcrun --show-sdk-path)}"
xcrun swiftc -O -sdk "$SWIFT_SDK" -framework AppKit -framework SwiftUI -framework WebKit -target arm64-apple-macosx13.0 desktop/*.swift -o "$APP/Contents/MacOS/1top"
xcrun swiftc -O -sdk "$SWIFT_SDK" -framework Security -target arm64-apple-macosx13.0 scripts/macos-credential-store.swift -o "$APP/Contents/Resources/agent/onetop-credential-store-v1.0.0"
scripts/macos-icon.sh
cp build/1top.icns "$APP/Contents/Resources/1top.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>1top</string><key>CFBundleIdentifier</key><string>si.1top.companion</string><key>CFBundleIconFile</key><string>1top.icns</string><key>CFBundleName</key><string>1top</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${VERSION}</string><key>CFBundleVersion</key><string>${BUILD_NUMBER}</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
# Local build only. A public release requires Developer ID signing + notarization.
echo "Local app built: $APP (not a notarized public release)"

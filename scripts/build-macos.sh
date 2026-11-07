#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${ONETOP_PYTHON:-.venv/bin/python}"
VERSION="$("$PYTHON" -c 'from onetop import __version__; print(__version__)')"
APP="build/1top_v${VERSION}/1top.app"
if [[ -e "$APP" ]]; then echo "Versioned build already exists: $APP" >&2; exit 1; fi
"$PYTHON" -m PyInstaller --noconfirm --clean --name onetop-agent --onedir --collect-data onetop --collect-data certifi --distpath build/agent-dist --workpath build/pyinstaller --specpath build scripts/agent_entry.py
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/agent"
cp -R build/agent-dist/onetop-agent/. "$APP/Contents/Resources/agent/"
SWIFT_SDK="${ONETOP_MACOS_SDK:-$(xcrun --show-sdk-path)}"
xcrun swiftc -O -sdk "$SWIFT_SDK" -framework AppKit -framework SwiftUI -framework WebKit -framework CoreText -target arm64-apple-macosx13.0 desktop/*.swift -o "$APP/Contents/MacOS/1top"
scripts/macos-icon.sh
cp -R desktop/Fonts "$APP/Contents/Resources/Fonts"
cp build/1top.icns "$APP/Contents/Resources/1top.icns"
cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>1top</string><key>CFBundleIdentifier</key><string>si.1top.companion</string><key>CFBundleIconFile</key><string>1top.icns</string><key>CFBundleName</key><string>1top</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${VERSION}</string><key>CFBundleVersion</key><string>3</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
# Local build only. A public release requires Developer ID signing + notarization.
echo "Local app built: $APP (not a notarized public release)"

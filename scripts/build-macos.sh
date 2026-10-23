#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
PYTHON="${ONETOP_PYTHON:-.venv/bin/python}"
APP="build/1top.app"
"$PYTHON" -m PyInstaller --noconfirm --clean --name onetop-agent --onedir --collect-data onetop --collect-data certifi --distpath build/agent-dist --workpath build/pyinstaller --specpath build scripts/agent_entry.py
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources/agent"
cp -R build/agent-dist/onetop-agent/. "$APP/Contents/Resources/agent/"
xcrun swiftc -O -framework AppKit -target arm64-apple-macosx13.0 desktop/OneTop.swift -o "$APP/Contents/MacOS/1top"
cat > "$APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>1top</string><key>CFBundleIdentifier</key><string>si.1top.companion</string><key>CFBundleName</key><string>1top</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>1.0.0</string><key>CFBundleVersion</key><string>1</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>LSUIElement</key><true/><key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
codesign --force --deep --sign - "$APP"
# Local build only. A public release requires Developer ID signing + notarization.
echo "Local app built: $APP (not a notarized public release)"

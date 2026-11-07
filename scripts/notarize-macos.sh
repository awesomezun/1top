#!/bin/bash
set -euo pipefail
: "${ONETOP_DEVELOPER_ID:?Set a Developer ID Application identity from your Keychain}"
: "${ONETOP_NOTARY_PROFILE:?Set the notarytool Keychain profile name}"
[[ "$ONETOP_DEVELOPER_ID" == 'Developer ID Application:'* ]] || { echo 'A Developer ID Application certificate is required.' >&2; exit 1; }
APP="${1:?Pass the versioned .app path}"
[[ -d "$APP/Contents" ]] || exit 1
# Preserve the local build; sign a separate production candidate.
OUT="${APP%.app}-signed.app"
[[ ! -e "$OUT" ]] || { echo 'Preserve the existing signed candidate.' >&2; exit 1; }
ditto "$APP" "$OUT"
python3 - "$OUT" <<'PY'
import os,subprocess,sys
from pathlib import Path
root=Path(sys.argv[1]);magic={bytes.fromhex(v) for v in ['feedface','cefaedfe','feedfacf','cffaedfe','cafebabe','bebafeca']}
for p in sorted(root.rglob('*'),key=lambda x:len(x.parts),reverse=True):
 if not p.is_file() or p.is_symlink():continue
 with p.open('rb') as f:is_macho=f.read(4) in magic
 if is_macho:subprocess.run(['codesign','--force','--options','runtime','--timestamp','--sign',os.environ['ONETOP_DEVELOPER_ID'],str(p)],check=True)
PY
codesign --force --options runtime --timestamp --sign "$ONETOP_DEVELOPER_ID" "$OUT"
codesign --verify --deep --strict "$OUT"
ditto -c -k --keepParent "$OUT" "$OUT.zip"
xcrun notarytool submit "$OUT.zip" --keychain-profile "$ONETOP_NOTARY_PROFILE" --wait
xcrun stapler staple "$OUT"
xcrun stapler validate "$OUT"
spctl --assess --type execute --verbose=2 "$OUT"
echo "Notarized candidate verified: $OUT"

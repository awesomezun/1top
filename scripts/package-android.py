"""Sign preview APK/AAB with the existing release key; never expose passwords."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile


def main():
    p=argparse.ArgumentParser()
    p.add_argument('--output',required=True,type=Path)
    p.add_argument('--sdk',type=Path,default=Path.home()/'Library/Android/sdk')
    p.add_argument('--java-home',type=Path,default=Path('/Applications/Android Studio.app/Contents/jbr/Contents/Home'))
    p.add_argument('--keystore',type=Path,default=Path.home()/'.config/1top/signing/android-upload.jks')
    p.add_argument('--password-file',type=Path,default=Path.home()/'.config/1top/signing/android-upload.pass')
    p.add_argument('--alias',default='onetop')
    args=p.parse_args();root=Path(__file__).resolve().parent.parent
    version=json.loads((root/'mobile/app.json').read_text())['expo']['version']
    args.output.mkdir(parents=True,exist_ok=True)
    apk=args.output/f'1top-{version}-android.apk';aab=args.output/f'1top-{version}-android.aab'
    if apk.exists() or aab.exists():raise SystemExit('Preserve existing versioned packages; choose a new output directory.')
    for f in (args.keystore,args.password_file):
        if not f.is_file():raise SystemExit('Existing release signing credentials are required.')
    signer=args.sdk/'build-tools/36.0.0/apksigner'
    env={**os.environ,'JAVA_HOME':str(args.java_home)}
    def run(command):
        result=subprocess.run(list(map(str,command)),capture_output=True,text=True,env=env)
        if result.returncode:raise SystemExit(result.stderr)
        return result.stdout
    built=root/'mobile/android/app/build/outputs'
    run([signer,'sign','--ks',args.keystore,'--ks-key-alias',args.alias,
         '--ks-pass','file:'+str(args.password_file),
         '--out',apk,built/'apk/release/app-release.apk'])
    report=run([signer,'verify','--print-certs',apk])
    digest=re.search(r'certificate SHA-256 digest: ([a-f0-9]+)',report).group(1)
    if digest!='6d18759f55d45c16718108e951a8353ac63222a71f90ae960da764270b19caf2':
        raise SystemExit('Release certificate does not match the previously distributed APK.')
    with zipfile.ZipFile(built/'bundle/release/app-release.aab') as src,zipfile.ZipFile(aab,'w',zipfile.ZIP_DEFLATED) as dst:
        for info in src.infolist():
            if info.filename.upper().startswith('META-INF/') and info.filename.upper().endswith(('.SF','.RSA','.DSA','.EC','MANIFEST.MF')):continue
            dst.writestr(info,src.read(info.filename))
    run([args.java_home/'bin/jarsigner','-keystore',args.keystore,'-storepass:file',args.password_file,aab,args.alias])
    run([args.java_home/'bin/jarsigner','-verify',aab])
    print(json.dumps({'version':version,'certificate_sha256':digest,'files':[
        {'path':str(f),'sha256':hashlib.sha256(f.read_bytes()).hexdigest()} for f in (apk,aab)]},indent=2))


if __name__=='__main__':main()

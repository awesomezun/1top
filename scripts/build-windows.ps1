$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = python -c "from onetop import __version__; print(__version__)"
New-Item -ItemType Directory -Force build/windows | Out-Null
Copy-Item site/public/brand/v1.1.0/icon.png desktop/windows/1top.png
python -c "from PIL import Image; Image.open('desktop/windows/1top.png').save('build/windows/1top.ico', format='ICO', sizes=[(16,16),(32,32),(48,48),(256,256)])"
python -m PyInstaller --noconfirm --clean --windowed --name 1top --onedir --collect-all webview --collect-data onetop --collect-data certifi --hidden-import pystray._win32 --add-data "$((Resolve-Path 'desktop/windows/1top.png').Path);." --icon (Resolve-Path build/windows/1top.ico).Path --distpath build/windows/dist --workpath build/windows/work --specpath build/windows desktop/windows/main.py
if ($LASTEXITCODE) { throw 'PyInstaller failed' }
& 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe' "/DAppVersion=$version" desktop/windows/installer.iss
if ($LASTEXITCODE) { throw 'Installer build failed' }
Get-FileHash "release/v$version/1top-$version-windows-x64-setup.exe" -Algorithm SHA256

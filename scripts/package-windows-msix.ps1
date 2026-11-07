param(
    [ValidateSet('test', 'store')][string]$Channel = 'store',
    [string]$IdentityFile,
    [string]$PackageVersion
)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
$version = python -c "from onetop import __version__; print(__version__)"
if (-not $PackageVersion) { $PackageVersion = "$version.0" }
$arguments = @('scripts/prepare-windows-msix.py', '--channel', $Channel, '--version', $PackageVersion)
if ($IdentityFile) { $arguments += @('--identity', $IdentityFile) }
python @arguments
if ($LASTEXITCODE) { throw 'MSIX payload preparation failed' }
$sdk = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\makeappx.exe" | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $sdk) { throw 'Windows SDK MakeAppx.exe is required' }
$output = "release/v$version/msix/$Channel"
New-Item -ItemType Directory -Force $output | Out-Null
$package = "$output/1top-$PackageVersion-windows-x64-$Channel.msix"
& $sdk.FullName pack /d build/windows/msix-stage /p $package /o /h SHA256
if ($LASTEXITCODE) { throw 'MSIX validation or packaging failed' }
$hash = (Get-FileHash $package -Algorithm SHA256).Hash.ToLower()
"$hash  $([IO.Path]::GetFileName($package))" | Set-Content "$package.sha256" -Encoding utf8NoBOM
@{version=$PackageVersion; channel=$Channel; file=[IO.Path]::GetFileName($package); sha256=$hash; signed=$false; storeCertified=$false} |
    ConvertTo-Json | Set-Content "$output/build-info.json" -Encoding utf8NoBOM
Write-Output "Created $Channel package: $package"

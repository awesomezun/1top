# Disposable GitHub Windows runner only. Never ask users to trust this certificate.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Test certificate trust is limited to disposable GitHub Actions runners' }
Set-Location (Join-Path $PSScriptRoot '..')
$version = python -c "from onetop import __version__; print(__version__)"
$package = "release/v$version/msix/test/1top-$version.0-windows-x64-test.msix"
$testRoot = 'build/windows/msix-test'
New-Item -ItemType Directory -Force $testRoot | Out-Null
$sdk = (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" | Sort-Object FullName -Descending | Select-Object -First 1).FullName
if (-not $sdk) { throw 'SignTool is required' }
$cert = $null
$trusted = $null
try {
    $cert = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature -CertStoreLocation 'Cert:\CurrentUser\My' `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3', '2.5.29.19={text}') `
        -Subject 'CN=1top MSIX CI' -FriendlyName '1top disposable MSIX validation' -NotAfter (Get-Date).AddDays(2)
    Export-Certificate -Cert $cert -FilePath "$testRoot/test-only.cer" | Out-Null
    $trusted = Import-Certificate -FilePath "$testRoot/test-only.cer" -CertStoreLocation 'Cert:\LocalMachine\TrustedPeople'
    Copy-Item $package "$testRoot/test-only.msix"
    & $sdk sign /fd SHA256 /sha1 $cert.Thumbprint "$testRoot/test-only.msix"
    if ($LASTEXITCODE) { throw 'Test signing failed' }
    & $sdk verify /pa /v "$testRoot/test-only.msix"
    if ($LASTEXITCODE) { throw 'Test signature verification failed' }
    Add-AppxPackage -Path (Resolve-Path "$testRoot/test-only.msix").Path
    $installed = Get-AppxPackage -Name '1top.MsixValidation'
    if (-not $installed -or $installed.Status -ne 'Ok') { throw 'MSIX did not install correctly' }
    $installed | Select-Object Name,PackageFullName,PackageFamilyName,InstallLocation,Status,Version |
        ConvertTo-Json | Set-Content "$testRoot/installed.json" -Encoding utf8NoBOM
    python scripts/windows-msix-smoke.py --package-info "$testRoot/installed.json"
    if ($LASTEXITCODE) { throw 'Installed MSIX launch verification failed' }
    # Updating the installed package must preserve WebView and collector data.
    $current = [version]"$version.0"
    $next = "$($current.Major).$($current.Minor).$($current.Build + 1).0"
    ./scripts/package-windows-msix.ps1 -Channel test -PackageVersion $next
    Copy-Item "release/v$version/msix/test/1top-$next-windows-x64-test.msix" "$testRoot/update-only.msix"
    & $sdk sign /fd SHA256 /sha1 $cert.Thumbprint "$testRoot/update-only.msix"
    if ($LASTEXITCODE) { throw 'Update test signing failed' }
    Add-AppxPackage -Path (Resolve-Path "$testRoot/update-only.msix").Path
    Get-AppxPackage -Name '1top.MsixValidation' | Select-Object Name,PackageFullName,PackageFamilyName,InstallLocation,Status,Version |
        ConvertTo-Json | Set-Content "$testRoot/updated.json" -Encoding utf8NoBOM
    python scripts/windows-msix-smoke.py --package-info "$testRoot/updated.json" --after-update
    if ($LASTEXITCODE) { throw 'MSIX update verification failed' }
} finally {
    Get-AppxPackage -Name '1top.MsixValidation' | Remove-AppxPackage
    $removed = -not [bool](Get-AppxPackage -Name '1top.MsixValidation')
    if ($trusted) { Remove-Item "Cert:\LocalMachine\TrustedPeople\$($trusted.Thumbprint)" -ErrorAction SilentlyContinue }
    if ($cert) { Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue }
    @{package_removed=$removed; test_trust_removed=($null -eq $trusted -or -not (Test-Path "Cert:\LocalMachine\TrustedPeople\$($trusted.Thumbprint)"))} |
        ConvertTo-Json | Set-Content "$testRoot/cleanup.json" -Encoding utf8NoBOM
}

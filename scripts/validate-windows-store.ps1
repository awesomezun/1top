# Validate a copy of the exact Store submission artifact in a disposable runner.
# The public submission file remains unsigned; the test certificate is never exported.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true') { throw 'Run only in a disposable GitHub Actions runner' }
Set-Location (Join-Path $PSScriptRoot '..')
$out = 'build/store-validation'
New-Item -ItemType Directory -Force $out | Out-Null
$identity = $env:STORE_IDENTITY | ConvertFrom-Json
if (-not $identity.name -or -not $identity.publisher) { throw 'Store identity is required' }
$packages = @(Get-ChildItem build/store-input -Recurse -Filter '*-store.msix')
if ($packages.Count -ne 1) { throw 'Expected exactly one Store submission package' }
$source = $packages[0].FullName
$sourceHash = (Get-FileHash $source -Algorithm SHA256).Hash.ToLower()
$sdk = (Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" |
    Sort-Object FullName -Descending | Select-Object -First 1).FullName
if (-not $sdk) { throw 'SignTool is required' }
$cert = $trusted = $installed = $appPid = $null
$result = @{source_sha256=$sourceHash; store_certified=$false; identity=$identity; consumer_windows_test=$false}
try {
    $cert = New-SelfSignedCertificate -Type Custom -KeyUsage DigitalSignature -CertStoreLocation 'Cert:\CurrentUser\My' `
        -TextExtension @('2.5.29.37={text}1.3.6.1.5.5.7.3.3','2.5.29.19={text}') `
        -Subject $identity.publisher -FriendlyName '1top disposable Store identity validation' -NotAfter (Get-Date).AddDays(1)
    $public = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($cert.RawData)
    $trustStore = [System.Security.Cryptography.X509Certificates.X509Store]::new('TrustedPeople','LocalMachine')
    $trustStore.Open('ReadWrite')
    try { $trustStore.Add($public); $trusted=$cert.Thumbprint } finally { $trustStore.Close() }
    $testPackage = Join-Path $env:RUNNER_TEMP '1top-store-validation.msix'
    Copy-Item $source $testPackage
    & $sdk sign /fd SHA256 /sha1 $cert.Thumbprint $testPackage
    if ($LASTEXITCODE) { throw 'Temporary test signing failed' }
    & $sdk verify /pa /v $testPackage
    if ($LASTEXITCODE) { throw 'Temporary test signature invalid' }
    Add-AppxPackage -Path $testPackage
    $installed = Get-AppxPackage -Name $identity.name
    if (-not $installed -or $installed.Status -ne 'Ok') { throw 'Store identity package failed to install' }
    $manifest = Get-AppxPackageManifest -Package $installed.PackageFullName
    if ($manifest.Package.Identity.Publisher -ne $identity.publisher) { throw 'Publisher mismatch' }
    $metadata = Get-Content (Join-Path $installed.InstallLocation 'app/distribution.json') -Raw | ConvertFrom-Json
    if ($metadata.channel -ne 'store') { throw 'This is not the Store distribution channel' }
    $result.package_full_name = $installed.PackageFullName
    $result.package_family_name = $installed.PackageFamilyName
    $result.installed = $true
    $appPid = [int](./scripts/activate-windows-msix.ps1 -AppId ($installed.PackageFamilyName + '!OneTop'))
    $result.activated_pid = $appPid
    $state = $null
    for ($i=0; $i -lt 180; $i++) {
        try { $state=Invoke-RestMethod 'http://127.0.0.1:18766/api/state' -TimeoutSec 2 -NoProxy } catch { $state=$null }
        if ($state.ready -eq $true) { break }
        Start-Sleep -Milliseconds 500
    }
    if ($state.ready -ne $true) { throw 'Final identity package collector did not become ready' }
    if ($state.system.host.memory.total -le 0) { throw 'System resources were not collected' }
    if (-not (Get-Process -Id $appPid -ErrorAction SilentlyContinue)) { throw 'Packaged UI exited unexpectedly' }
    $updates = Invoke-RestMethod 'http://127.0.0.1:18766/api/updates' -TimeoutSec 5 -NoProxy
    if ($updates.channel -ne 'microsoft-store') { throw 'Incorrect update channel' }
    $result.collector_ready=$true
    $result.version=$state.version
    $result.update_channel=$updates.channel
    $result.memory_bytes=$state.system.host.memory.total
    Add-Type -AssemblyName System.Windows.Forms,System.Drawing
    Start-Sleep -Seconds 3
    $bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
    $bitmap=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
    $graphics=[System.Drawing.Graphics]::FromImage($bitmap)
    try {
        $graphics.CopyFromScreen($bounds.Left,$bounds.Top,0,0,$bounds.Size)
        $bitmap.Save((Join-Path (Resolve-Path $out) 'store-installed.png'))
    } finally { $graphics.Dispose(); $bitmap.Dispose() }
    & taskkill /PID $appPid /T /F | Out-Null
    $appPid=$null
    $kit="${env:ProgramFiles(x86)}\Windows Kits\10\App Certification Kit\appcert.exe"
    $result.wack=@{available=(Test-Path $kit); session_id=(Get-Process -Id $PID).SessionId; passed=$false}
    if ((Test-Path $kit) -and $result.wack.session_id -ne 0) {
        & $kit reset
        $report=Join-Path (Resolve-Path $out) 'wack.xml'
        $proc=Start-Process $kit -ArgumentList @('test','-packagefullname',$installed.PackageFullName,'-reportoutputpath',('"'+$report+'"')) -PassThru
        if (-not $proc.WaitForExit(600000)) { $proc.Kill(); $result.wack.error='Timed out after 10 minutes' }
        else { $result.wack.exit_code=$proc.ExitCode }
        $result.wack.report_exists=Test-Path $report
        if (Test-Path $report) {
            [xml]$xml=Get-Content $report -Raw
            $result.wack.overall_result=$xml.REPORT.OVERALL_RESULT
            $findings=@($xml.SelectNodes('//TEST') | Where-Object { $_.RESULT.InnerText -ne 'PASS' } | ForEach-Object {
                @{name=$_.NAME; result=$_.RESULT.InnerText; optional=($_.OPTIONAL -eq 'TRUE');
                  messages=@($_.MESSAGES.MESSAGE | ForEach-Object { $_.TEXT })}
            })
            $result.wack.findings=$findings
            $result.wack.required_tests_passed=(@($findings | Where-Object { -not $_.optional }).Count -eq 0)
            $result.wack.passed=($xml.REPORT.OVERALL_RESULT -eq 'PASS')
            if (-not $result.wack.required_tests_passed) { throw 'Review mandatory WACK findings in verification.json and wack.xml' }
        } else { throw 'WACK produced no report' }
    } else { $result.wack.error='WACK or an active non-Session0 desktop is unavailable on this runner' }
} finally {
    if ($appPid) { & taskkill /PID $appPid /T /F 2>$null | Out-Null }
    Get-AppxPackage -Name $identity.name | Remove-AppxPackage
    if ($trusted) { Remove-Item "Cert:\LocalMachine\TrustedPeople\$trusted" -ErrorAction SilentlyContinue }
    if ($cert) { Remove-Item "Cert:\CurrentUser\My\$($cert.Thumbprint)" -ErrorAction SilentlyContinue }
    $result.package_removed=-not [bool](Get-AppxPackage -Name $identity.name)
    $result.test_trust_removed=($null -eq $trusted -or -not (Test-Path "Cert:\LocalMachine\TrustedPeople\$trusted"))
    $result.source_unchanged=((Get-FileHash $source -Algorithm SHA256).Hash.ToLower() -eq $sourceHash)
    $result | ConvertTo-Json -Depth 8 | Set-Content "$out/verification.json" -Encoding utf8NoBOM
}

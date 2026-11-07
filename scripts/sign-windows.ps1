param([Parameter(Mandatory=$true)][string]$Path,[Parameter(Mandatory=$true)][string]$Thumbprint,[Parameter(Mandatory=$true)][string]$TimestampServer)
$ErrorActionPreference='Stop'
$cert=Get-Item "Cert:\CurrentUser\My\$Thumbprint"
if (!$cert.HasPrivateKey -or $cert.NotAfter -lt (Get-Date)) { throw 'A current code-signing certificate with a private key is required.' }
$files=if(Test-Path -LiteralPath $Path -PathType Container){Get-ChildItem -LiteralPath $Path -Recurse -File | Where-Object {$_.Extension -in '.exe','.dll','.pyd'}}else{Get-Item -LiteralPath $Path}
foreach($file in $files){
 $result=Set-AuthenticodeSignature -LiteralPath $file.FullName -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $TimestampServer
 if($result.Status -ne 'Valid'){throw "Signing failed: $($file.Name)"}
 $verified=Get-AuthenticodeSignature -LiteralPath $file.FullName
 if($verified.Status -ne 'Valid' -or $verified.SignerCertificate.Thumbprint -ne $Thumbprint){throw 'Publisher signature verification failed.'}
}

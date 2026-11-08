param([Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
$sources=@((Join-Path $PSScriptRoot 'QuietTunnelLauncher.cs'),(Join-Path $PSScriptRoot 'process-job.cs'))
$hashInput=([string]::Join(':',@($sources | ForEach-Object {(Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash})))
$sha=[Security.Cryptography.SHA256]::Create()
try {$fingerprint=([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($hashInput))).Replace('-','').Substring(0,16).ToLowerInvariant())}
finally {$sha.Dispose()}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$directory=[IO.Path]::GetFullPath($OutputDirectory)
$output=Join-Path $directory ("KeepliveTunnelLauncher-$fingerprint.exe")
if(-not(Test-Path -LiteralPath $output -PathType Leaf)) {
    $temporary=Join-Path $directory ([Guid]::NewGuid().ToString()+'.exe')
    try {
        Add-Type -Path $sources -OutputAssembly $temporary -OutputType WindowsApplication -ReferencedAssemblies @('System.dll')
        Move-Item -LiteralPath $temporary -Destination $output
    } finally {
        if(Test-Path -LiteralPath $temporary){Remove-Item -LiteralPath $temporary}
    }
}
Write-Output $output

param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9.-]+$')][string]$ServerHost,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$ServerUser,
    [Parameter(Mandatory=$true)][string]$IdentityFile,
    [ValidateRange(1,65535)][int]$RemotePort=13210,
    [ValidateRange(1,65535)][int]$LocalPort=3210
)
$ErrorActionPreference='Stop'
$project=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$ssh=(Get-Command ssh.exe -ErrorAction Stop).Source
$identity=(Resolve-Path -LiteralPath $IdentityFile).Path
$arguments=@('-F','none','-N','-T','-i',('"'+$identity+'"'),'-o','IdentitiesOnly=yes','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=3','-o','ConnectTimeout=10','-R',("127.0.0.1:${RemotePort}:127.0.0.1:${LocalPort}"),("${ServerUser}@${ServerHost}"))
$mutex=[Threading.Mutex]::new($false,('Local\KeepliveTunnel-'+$ServerHost+'-'+$RemotePort))
$owned=$false
$child=$null
$job=$null
try {
    try { $owned=$mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned=$true }
    if (-not $owned) { exit 0 }
    Add-Type -Path (Join-Path $PSScriptRoot 'process-job.cs')
    $logs=Join-Path $project '.data/logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $stdout=Join-Path $logs 'tunnel.log'
    $stderr=Join-Path $logs 'tunnel-error.log'
    $history=Join-Path $logs 'tunnel-supervisor.log'
    while ($true) {
        foreach($file in @($stdout,$stderr)) { if(Test-Path -LiteralPath $file) { Move-Item -LiteralPath $file -Destination ($file+'.previous') -Force } }
        if((Test-Path -LiteralPath $history) -and (Get-Item -LiteralPath $history).Length -gt 10MB) { Move-Item -LiteralPath $history -Destination ($history+'.previous') -Force }
        try {
            $job=[KeepliveProcessJob]::new()
            $start=New-Object Diagnostics.ProcessStartInfo
            $start.FileName=$ssh
            $start.Arguments=($arguments -join ' ')
            $start.WorkingDirectory=$project
            $start.UseShellExecute=$false
            $start.CreateNoWindow=$true
            $start.RedirectStandardOutput=$true
            $start.RedirectStandardError=$true
            $process=New-Object Diagnostics.Process
            $process.StartInfo=$start
            try {if(-not $process.Start()){throw 'SSH process did not start.'}}
            catch {$process.Dispose();throw}
            $child=$process
            $job.Attach($child.Handle)
            $outputTask=$child.StandardOutput.ReadToEndAsync()
            $errorTask=$child.StandardError.ReadToEndAsync()
            Add-Content -LiteralPath $history -Encoding UTF8 -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+' Started SSH PID '+$child.Id)
            $child.WaitForExit()
            [IO.File]::WriteAllText($stdout,$outputTask.GetAwaiter().GetResult(),(New-Object Text.UTF8Encoding($false)))
            [IO.File]::WriteAllText($stderr,$errorTask.GetAwaiter().GetResult(),(New-Object Text.UTF8Encoding($false)))
            Add-Content -LiteralPath $history -Encoding UTF8 -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+' SSH exited '+$child.ExitCode+'; retry in 5 seconds.')
        } catch {
            Add-Content -LiteralPath $history -Encoding UTF8 -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss')+' '+$_.Exception.Message)
        } finally {
            if($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue }
            if($job) { $job.Dispose(); $job=$null }
            if($child) { $child.Dispose(); $child=$null }
        }
        Start-Sleep -Seconds 5
    }
} finally {
    if($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue }
    if($job) { $job.Dispose() }
    if($child) { $child.Dispose() }
    if($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}

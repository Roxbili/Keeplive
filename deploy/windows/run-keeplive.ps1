param(
    [string]$ProjectPath = (Join-Path $PSScriptRoot '../..'),
    [string]$NodePath = '',
    [ValidateRange(5, 300)][int]$RestartDelaySeconds = 5
)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath $ProjectPath).Path
$entry = Join-Path $project 'server/index.js'
if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { throw 'Keeplive server/index.js is missing.' }
if (-not $NodePath) { $NodePath = (Get-Command node.exe -ErrorAction Stop).Source }
if (-not (Test-Path -LiteralPath $NodePath -PathType Leaf)) { throw 'Node.js executable is missing.' }

# Prevent duplicate background runners, including manual starts of this script.
$hash = [Security.Cryptography.SHA256]::Create()
try { $key = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($project.ToLowerInvariant()))).Replace('-', '') }
finally { $hash.Dispose() }
$mutex = [Threading.Mutex]::new($false, ('Local\Keeplive-' + $key))
$owned = $false
$child = $null
$processJob = $null
$outFile = $null
$errFile = $null
$outCopy = $null
$errCopy = $null
try {
    try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
    if (-not $owned) { exit 0 }
    Add-Type -Path (Join-Path $PSScriptRoot 'process-job.cs')
    $logs = Join-Path $project '.data/logs'
    New-Item -ItemType Directory -Path $logs -Force | Out-Null
    $stdout = Join-Path $logs 'server.log'
    $stderr = Join-Path $logs 'server-error.log'
    $supervisor = Join-Path $logs 'autostart.log'
    function Write-ServiceLog([string]$Message) {
        Add-Content -LiteralPath $supervisor -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $Message) -Encoding UTF8
    }
    while ($true) {
        foreach ($file in @($stdout, $stderr, $supervisor)) {
            if ((Test-Path -LiteralPath $file) -and (($file -ne $supervisor) -or (Get-Item -LiteralPath $file).Length -gt 10MB)) {
                Move-Item -LiteralPath $file -Destination ($file + '.previous') -Force
            }
        }
        try {
            $processJob = [KeepliveProcessJob]::new()
            $start = [Diagnostics.ProcessStartInfo]::new()
            $start.FileName = $NodePath
            $start.Arguments = '"' + $entry + '"'
            $start.WorkingDirectory = $project
            $start.UseShellExecute = $false
            $start.CreateNoWindow = $true
            $start.RedirectStandardInput = $true
            $start.RedirectStandardOutput = $true
            $start.RedirectStandardError = $true
            $child = [Diagnostics.Process]::new()
            $child.StartInfo = $start
            if (-not $child.Start()) { $child.Dispose(); $child = $null; throw 'Node process did not start.' }
            # Keep the handle open so Windows PowerShell can read ExitCode after WaitForExit.
            $processJob.Attach($child.Handle)
            $child.StandardInput.Close()
            # Stream directly to files: bounded memory and logs visible before Node exits.
            $outFile = [IO.FileStream]::new($stdout, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite, 1, $true)
            $errFile = [IO.FileStream]::new($stderr, [IO.FileMode]::Create, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite, 1, $true)
            $outCopy = $child.StandardOutput.BaseStream.CopyToAsync($outFile)
            $errCopy = $child.StandardError.BaseStream.CopyToAsync($errFile)
            Write-ServiceLog ('Started Node PID ' + $child.Id)
            $child.WaitForExit()
            # Reap descendants before waiting for EOF: they may retain output pipes.
            $processJob.Dispose()
            $processJob = $null
            $outCopy.GetAwaiter().GetResult()
            $errCopy.GetAwaiter().GetResult()
            Write-ServiceLog ('Node exited with code ' + $child.ExitCode + '; retry in ' + $RestartDelaySeconds + ' seconds.')
        } catch {
            Write-ServiceLog ('Start failed: ' + $_.Exception.Message)
        } finally {
            if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue }
            if ($processJob) { $processJob.Dispose(); $processJob = $null }
            if ($outCopy) { try { $outCopy.GetAwaiter().GetResult() } catch {}; $outCopy = $null }
            if ($errCopy) { try { $errCopy.GetAwaiter().GetResult() } catch {}; $errCopy = $null }
            if ($outFile) { $outFile.Dispose(); $outFile = $null }
            if ($errFile) { $errFile.Dispose(); $errFile = $null }
            if ($child) { $child.Dispose(); $child = $null }
        }
        Start-Sleep -Seconds $RestartDelaySeconds
    }
} finally {
    if ($child -and -not $child.HasExited) { Stop-Process -Id $child.Id -ErrorAction SilentlyContinue }
    if ($processJob) { $processJob.Dispose() }
    if ($child) { $child.Dispose() }
    if ($owned) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}

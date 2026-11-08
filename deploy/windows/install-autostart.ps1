param([switch]$DoNotStart)
$ErrorActionPreference = 'Stop'
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$runner = Join-Path $PSScriptRoot 'run-keeplive.ps1'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$version = & $node --version
if ([int]($version.TrimStart('v').Split('.')[0]) -lt 24) { throw 'Keeplive requires Node.js 24 or newer.' }
foreach ($required in @('server/index.js', 'node_modules/express/package.json', 'dist/index.html')) {
    if (-not (Test-Path -LiteralPath (Join-Path $project $required))) { throw ('Missing ' + $required + '. Run npm ci and npm run build first.') }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$taskName = 'Keeplive-' + $identity.User.Value
$launcher = & (Join-Path $PSScriptRoot 'build-tunnel-launcher.ps1') -OutputDirectory (Join-Path $env:LOCALAPPDATA 'Keeplive/Service')
$arguments = '"' + $runner + '" -NodePath "' + $node + '"'
$action = New-ScheduledTaskAction -Execute $launcher -Argument $arguments -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$principal = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and $existing.State -eq 'Running') { throw 'Keeplive autostart is already running. Stop its task before reinstalling.' }
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description ('Keeplive background photo service: ' + $project) -Force | Out-Null
if (-not $DoNotStart) { Start-ScheduledTask -TaskName $taskName }
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName, State

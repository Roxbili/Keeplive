param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9.-]+$')][string]$ServerHost,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$ServerUser,
    [Parameter(Mandatory=$true)][string]$IdentityFile,
    [ValidateRange(1,65535)][int]$RemotePort=13210,
    [ValidateRange(1,65535)][int]$LocalPort=3210
)
$ErrorActionPreference='Stop'
$project=(Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$key=(Resolve-Path -LiteralPath $IdentityFile).Path
$identity=[Security.Principal.WindowsIdentity]::GetCurrent()
$name='Keeplive-Tunnel-'+$identity.User.Value
$existing=Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
if($existing -and $existing.State -eq 'Running') { throw 'Tunnel is already running. Stop its task before reinstalling.' }
$runner=Join-Path $PSScriptRoot 'run-tunnel.ps1'
$launcher=(& (Join-Path $PSScriptRoot 'build-tunnel-launcher.ps1') -OutputDirectory (Join-Path $env:LOCALAPPDATA 'Keeplive/Tunnel')).Trim()
if(-not(Test-Path -LiteralPath $launcher -PathType Leaf)){throw 'Tunnel launcher build failed.'}
$tunnelArguments='"'+$runner+'" -ServerHost "'+$ServerHost+'" -ServerUser "'+$ServerUser+'" -IdentityFile "'+$key+'" -RemotePort '+$RemotePort+' -LocalPort '+$LocalPort
$action=New-ScheduledTaskAction -Execute $launcher -Argument $tunnelArguments -WorkingDirectory $project
$trigger=New-ScheduledTaskTrigger -AtLogOn -User $identity.Name
$principal=New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType Interactive -RunLevel Limited
$settings=New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Keeplive encrypted reverse SSH connection; loopback backend only.' -Force | Out-Null
Start-ScheduledTask -TaskName $name
Get-ScheduledTask -TaskName $name | Select-Object TaskName,State

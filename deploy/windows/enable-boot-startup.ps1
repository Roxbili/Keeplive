# Run once from an elevated PowerShell under the account that owns Keeplive.
# No password is written to a file, printed, or passed on a command line.
function ConvertTo-KeepliveBootTaskXml {
    param([Parameter(Mandatory=$true)][string]$Xml)
    $document = [xml]$Xml
    $ns = 'http://schemas.microsoft.com/windows/2004/02/mit/task'
    if ($document.DocumentElement.NamespaceURI -ne $ns) { throw 'Invalid task XML namespace.' }
    $principal = $document.Task.Principals.Principal
    if (@($principal).Count -ne 1 -or -not $principal.UserId) { throw 'Expected one user principal.' }
    $principal.LogonType = 'Password'
    $triggers = $document.Task.Triggers
    if (-not $triggers) { throw 'Task triggers are missing.' }
    $triggers.RemoveAll()
    $boot = $document.CreateElement('BootTrigger', $ns)
    foreach ($pair in @(@('Enabled','true'),@('Delay','PT30S'))) {
        $element = $document.CreateElement($pair[0], $ns)
        $element.InnerText = $pair[1]
        [void]$boot.AppendChild($element)
    }
    [void]$triggers.AppendChild($boot)
    return $document.OuterXml
}

# Allow tests to load the pure XML conversion without touching the scheduler.
if ($MyInvocation.InvocationName -eq '.') { return }
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
if (-not ([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Open PowerShell as administrator under your Keeplive account, then run this script again.'
}
$names = @(('Keeplive-' + $identity.User.Value),('Keeplive-Tunnel-' + $identity.User.Value))
$backup = Join-Path $env:LOCALAPPDATA ('Codex/maintenance/keeplive-boot-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $backup | Out-Null
$original = @{}
$converted = @{}
foreach ($name in $names) {
    $task = Get-ScheduledTask -TaskName $name
    if ($task.Principal.LogonType -notin @('Interactive','Password')) { throw ('Unsupported existing logon type: ' + $name) }
    $taskOwner = [Security.Principal.NTAccount]::new($task.Principal.UserId).Translate([Security.Principal.SecurityIdentifier])
    if ($taskOwner.Value -ne $identity.User.Value) { throw ('Task account does not match current account: ' + $name) }
    if ($task.Principal.RunLevel -ne 'Limited') { throw 'Expected ordinary, non-elevated task runtime.' }
    $original[$name] = Export-ScheduledTask -TaskName $name
    $converted[$name] = ConvertTo-KeepliveBootTaskXml -Xml $original[$name]
    [IO.File]::WriteAllText((Join-Path $backup ($name + '.xml')), $original[$name], [Text.Encoding]::Unicode)
}
Write-Host 'Enter your Windows account PASSWORD, not your Windows Hello PIN. It is stored only by Windows Task Scheduler.'
$credential = Get-Credential -UserName $identity.Name -Message 'Allow Keeplive photos and SSH to start before Windows sign-in.'
if (-not $credential) { throw 'Cancelled. Existing tasks have not been changed.' }
$credentialOwner = [Security.Principal.NTAccount]::new($credential.UserName).Translate([Security.Principal.SecurityIdentifier])
if ($credentialOwner.Value -ne $identity.User.Value) { throw 'Use the same Windows account that owns the existing tasks.' }
$changed = [Collections.Generic.List[string]]::new()
try {
    $password = $credential.GetNetworkCredential().Password
    foreach ($name in $names) {
        Register-ScheduledTask -TaskName $name -Xml $converted[$name] -User $identity.Name -Password $password -Force | Out-Null
        $changed.Add($name)
    }
    foreach ($name in $names) {
        $task = Get-ScheduledTask -TaskName $name
        if ($task.Principal.LogonType -ne 'Password' -or @($task.Triggers).Count -ne 1 -or $task.Triggers[0].CimClass.CimClassName -ne 'MSFT_TaskBootTrigger') {
            throw ('Task verification failed: ' + $name)
        }
    }
    Write-Host 'Configured: both tasks start 30 seconds after boot, without interactive sign-in.'
    Write-Host 'Current running instances were not stopped. No reboot has been requested.'
    Write-Host ('Task XML backup: ' + $backup)
    Get-ScheduledTask -TaskName $names | Select-Object TaskName, State, @{Name='LogonType';Expression={$_.Principal.LogonType}}
} catch {
    $failure = $_
    foreach ($name in $changed) {
        try {
            $old = [xml]$original[$name]
            if ($old.Task.Principals.Principal.LogonType -eq 'Password') {
                Register-ScheduledTask -TaskName $name -Xml $original[$name] -User $identity.Name -Password $password -Force | Out-Null
            } else {
                Register-ScheduledTask -TaskName $name -Xml $original[$name] -Force | Out-Null
            }
        } catch { Write-Warning ('Restore failed for ' + $name + '; task XML backup: ' + $backup) }
    }
    throw $failure
} finally {
    $password = $null
    if ($credential) { $credential.Password.Dispose(); $credential = $null }
}

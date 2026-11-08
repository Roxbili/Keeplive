$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$dialog = $null
$owner = $null
try {
  if (-not [Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) {
    throw 'An interactive desktop is required'
  }
  # Set DPI awareness before WinForms or any window can inherit a scaled context.
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class KeepliveDisplay {
  [DllImport("user32.dll", SetLastError = true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetProcessDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError = true)]
  private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("shcore.dll")]
  private static extern int SetProcessDpiAwareness(int awareness);
  [DllImport("user32.dll")]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool SetProcessDPIAware();
  public static void Enable() {
    try {
      SetProcessDpiAwarenessContext(new IntPtr(-4));
      // Thread override also works when the host already set process awareness.
      if (SetThreadDpiAwarenessContext(new IntPtr(-4)) != IntPtr.Zero) return;
    } catch (EntryPointNotFoundException) {} catch (DllNotFoundException) {}
    try { SetProcessDpiAwareness(2); }
    catch (EntryPointNotFoundException) { SetProcessDPIAware(); }
    catch (DllNotFoundException) { SetProcessDPIAware(); }
  }
}
'@
  [KeepliveDisplay]::Enable()
  Add-Type -AssemblyName System.Windows.Forms
  $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
  $dialog.Description = '选择 Keeplive 照片文件夹'
  $dialog.ShowNewFolderButton = $false
  if ($dialog.PSObject.Properties['AutoUpgradeEnabled']) { $dialog.AutoUpgradeEnabled = $true }
  if ($dialog.PSObject.Properties['UseDescriptionForTitle']) { $dialog.UseDescriptionForTitle = $true }
  $initial = [Environment]::GetEnvironmentVariable('KEEPLIVE_PICKER_INITIAL')
  if ($initial -and [IO.Directory]::Exists($initial)) { $dialog.SelectedPath = $initial }
  # A transparent owner keeps the modal picker in front without a console window.
  $owner = New-Object System.Windows.Forms.Form
  $owner.ShowInTaskbar = $false
  $owner.TopMost = $true
  $owner.Opacity = 0
  $owner.StartPosition = 'CenterScreen'
  $owner.Size = New-Object System.Drawing.Size(1, 1)
  $owner.Show()
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    @{ path = $dialog.SelectedPath; canceled = $false } | ConvertTo-Json -Compress
  } else {
    @{ path = $null; canceled = $true } | ConvertTo-Json -Compress
  }
} catch {
  [Console]::Error.WriteLine('Keeplive folder picker is unavailable')
  exit 1
} finally {
  if ($dialog) { $dialog.Dispose() }
  if ($owner) { $owner.Dispose() }
}

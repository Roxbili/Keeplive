import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('native picker enables per-monitor v2 before creating its first window', {skip:process.platform!=='win32'},async context=>{
  const script=await readFile(new URL('../server/native-directory.ps1',import.meta.url),'utf8');
  // Stop at the external window-creation boundary; inspect real Windows DPI
  // state after executing the actual picker startup, without displaying UI.
  const probe=[
    "$ProgressPreference = 'SilentlyContinue'",
    "if (-not [Environment]::UserInteractive -or [Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0) { @{skip='An interactive Windows desktop is required'} | ConvertTo-Json -Compress; exit 0 }",
    "Add-Type -TypeDefinition @'",
    'using System; using System.Runtime.InteropServices;',
    'public static class PickerDpiProbe {',
    ' [DllImport("user32.dll")] public static extern IntPtr GetThreadDpiAwarenessContext();',
    ' [DllImport("user32.dll")] public static extern int GetAwarenessFromDpiAwarenessContext(IntPtr context);',
    ' [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool AreDpiAwarenessContextsEqual(IntPtr a, IntPtr b);',
    ' [DllImport("user32.dll")] [return: MarshalAs(UnmanagedType.Bool)] public static extern bool IsValidDpiAwarenessContext(IntPtr context);',
    '}',"'@",
    "try { if (-not [PickerDpiProbe]::IsValidDpiAwarenessContext([IntPtr](-4))) { throw 'PMv2 unavailable' } } catch { @{skip='Per-monitor v2 is unavailable on this Windows version'} | ConvertTo-Json -Compress; exit 0 }",
    'function New-Object {',
    " if ($args[0] -eq 'System.Windows.Forms.FolderBrowserDialog') {",
    '  $context = [PickerDpiProbe]::GetThreadDpiAwarenessContext()',
    '  @{awareness=[PickerDpiProbe]::GetAwarenessFromDpiAwarenessContext($context);perMonitorV2=[PickerDpiProbe]::AreDpiAwarenessContextsEqual($context,[IntPtr](-4))} | ConvertTo-Json -Compress',
    '  exit 0',
    ' }',
    ' Microsoft.PowerShell.Utility\\New-Object @args',
    '}',script
  ].join('\n');
  const {stdout}=await promisify(execFile)('powershell.exe',['-NoLogo','-NoProfile','-STA','-EncodedCommand',Buffer.from(probe,'utf16le').toString('base64')],{windowsHide:true,encoding:'utf8',timeout:60000});
  const result=JSON.parse(stdout.trim());if(result.skip){context.skip(result.skip);return;}assert.equal(result.awareness,2,'The picker must render at each monitor DPI');assert.equal(result.perMonitorV2,true,'Dialog scaling must be handled before its HWND is created');
});

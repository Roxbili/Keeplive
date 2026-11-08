import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const windows = process.platform === 'win32';
const deploy = fileURLToPath(new URL('../deploy/windows/', import.meta.url));
const psArgs = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'RemoteSigned'];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(read, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await read();
    if (value) return value;
    await pause(100);
  }
  throw new Error('等待隧道测试进程超时');
}

// 删除 CreateNoWindow 或不再回收 SSH 子进程，应使本测试失败。
test('SSH tunnel has no console and closes its child with the supervisor', { skip: !windows, timeout: 60000 }, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'keeplive tunnel '));
  const root = path.join(base, 'project with spaces');
  const dir = path.join(root, 'deploy', 'windows');
  const bin = path.join(base, 'bin');
  await mkdir(dir, { recursive: true }); await mkdir(bin);
  await copyFile(path.join(deploy, 'run-tunnel.ps1'), path.join(dir, 'run-tunnel.ps1'));
  await copyFile(path.join(deploy, 'process-job.cs'), path.join(dir, 'process-job.cs'));
  const key = path.join(base, 'key with spaces'); await writeFile(key, 'test fixture');
  const marker = path.join(base, 'ssh-process.txt');
  const source = path.join(base, 'Probe.cs');
  await writeFile(source, `using System; using System.IO; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;
class Probe { [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow(); static void Main(string[] args) {
File.WriteAllText(Environment.GetEnvironmentVariable("KEEP_TEST_MARKER"), Process.GetCurrentProcess().Id+"|"+GetConsoleWindow().ToInt64()+"|"+string.Join(";",args)); Thread.Sleep(Timeout.Infinite); } }`);
  const compile = path.join(base, 'compile.ps1');
  await writeFile(compile, 'param($Source,$Output)\nAdd-Type -Path $Source -OutputAssembly $Output -OutputType ConsoleApplication\n');
  const built = spawnSync('powershell.exe', [...psArgs, '-File', compile, '-Source', source, '-Output', path.join(bin, 'ssh.exe')], { windowsHide: true, timeout: 30000 });
  assert.equal(built.status, 0, built.stderr?.toString());
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toLowerCase() !== 'path'));
  env.Path = bin + ';' + (process.env.Path ?? process.env.PATH); env.KEEP_TEST_MARKER = marker;
  const child = spawn('powershell.exe', [...psArgs, '-File', path.join(dir, 'run-tunnel.ps1'), '-ServerHost', 'unit.test', '-ServerUser', 'fixture', '-IdentityFile', key, '-RemotePort', '24321', '-LocalPort', '24322'], { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = ''; child.stderr.on('data', chunk => { errors += chunk; }); child.stdout.resume();
  const exited = new Promise(resolve => child.once('exit', resolve));
  let sshPid;
  try {
    const observation = await waitFor(async () => {
      assert.equal(child.exitCode, null, errors);
      try { return await readFile(marker, 'utf8'); } catch { return null; }
    });
    const [pid, consoleHandle, args] = observation.split('|'); sshPid = Number(pid);
    assert.equal(consoleHandle, '0', 'SSH 不应分配控制台窗口');
    assert.ok(args.includes(key), '带空格的密钥路径必须准确传递');
    assert.ok(args.includes('127.0.0.1:24321:127.0.0.1:24322'));
    child.kill(); await exited;
    await waitFor(async () => { try { process.kill(sshPid, 0); return false; } catch { return true; } });
  } finally {
    if (child.exitCode === null) spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    await exited;
    if (sshPid) { try { process.kill(sshPid); } catch {} }
    // 本测试只清理它在系统临时目录下创建的唯一目录。
    assert.ok(base.startsWith(path.join(tmpdir(), 'keeplive tunnel ')));
    await rm(base, { recursive: true, force: true });
  }
});

// 改成控制台程序、破坏 Windows 引号转义、丢失退出码都应使本测试失败。
test('GUI tunnel launcher preserves arguments, exit status and console-free execution', { skip: !windows, timeout: 60000 }, async () => {
  const builder = path.join(deploy, 'build-tunnel-launcher.ps1');
  assert.ok(existsSync(builder), '需要真正无控制台的隧道启动器构建脚本');
  const base = await mkdtemp(path.join(tmpdir(), 'keeplive launcher '));
  try {
    const out = path.join(base, 'output with spaces');
    const built = spawnSync('powershell.exe', [...psArgs, '-File', builder, '-OutputDirectory', out], { windowsHide: true, timeout: 30000 });
    assert.equal(built.status, 0, built.stderr?.toString());
    const exe = built.stdout.toString().trim();
    const pe = await readFile(exe); const offset = pe.readUInt32LE(0x3c);
    assert.equal(pe.readUInt16LE(offset + 24 + 68), 2, '启动器必须使用 Windows GUI 子系统');
    const probe = path.join(base, 'probe.ps1'); const record = path.join(base, 'result.json');
    await writeFile(probe, `param([string]$RecordPath,[string]$Value)
Add-Type 'using System; using System.Runtime.InteropServices; public class WindowProbe { [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
[IO.File]::WriteAllText($RecordPath,(@{Value=$Value;Console=[WindowProbe]::GetConsoleWindow().ToInt64()} | ConvertTo-Json),(New-Object Text.UTF8Encoding($false)))
exit 17
`);
    const value = 'two words "quoted" C:\\folder with spaces\\';
    const result = spawnSync(exe, [probe, '-RecordPath', record, '-Value', value], { windowsHide: true, timeout: 30000 });
    assert.equal(result.status, 17, result.stderr?.toString());
    const seen = JSON.parse(await readFile(record, 'utf8'));
    assert.equal(seen.Value, value); assert.equal(seen.Console, 0);
  } finally {
    assert.ok(base.startsWith(path.join(tmpdir(), 'keeplive launcher ')));
    await rm(base, { recursive: true, force: true });
  }
});

// 只替换操作系统 Job 绑定失败这个边界，PowerShell 进程和启动器仍真实运行。
test('launcher terminates an already-started worker when Job assignment fails', { skip: !windows, timeout: 60000 }, async () => {
  const base = await mkdtemp(path.join(tmpdir(), 'keeplive failed job '));
  let workerPid;
  try {
    await copyFile(path.join(deploy, 'QuietTunnelLauncher.cs'), path.join(base, 'QuietTunnelLauncher.cs'));
    await copyFile(path.join(deploy, 'build-tunnel-launcher.ps1'), path.join(base, 'build-tunnel-launcher.ps1'));
    await writeFile(path.join(base, 'process-job.cs'), `using System; using System.IO; using System.Runtime.InteropServices;
public sealed class KeepliveProcessJob : IDisposable {
[DllImport("kernel32.dll")] static extern uint GetProcessId(IntPtr process);
public void Attach(IntPtr process) { File.WriteAllText(Environment.GetEnvironmentVariable("KEEP_TEST_WORKER"),GetProcessId(process).ToString()); throw new InvalidOperationException("Job assignment denied"); }
public void Dispose() {} }`);
    const built = spawnSync('powershell.exe', [...psArgs, '-File', path.join(base, 'build-tunnel-launcher.ps1'), '-OutputDirectory', path.join(base, 'bin')], { windowsHide: true, timeout: 30000 });
    assert.equal(built.status, 0, built.stderr?.toString());
    const record = path.join(base, 'worker.txt');
    const probe = path.join(base, 'worker.ps1'); await writeFile(probe, 'Start-Sleep -Seconds 60\n');
    const result = spawnSync(built.stdout.toString().trim(), [probe], { windowsHide: true, env: { ...process.env, KEEP_TEST_WORKER: record }, timeout: 10000 });
    workerPid = Number(await readFile(record, 'utf8'));
    assert.equal(result.status, 1);
    assert.throws(() => process.kill(workerPid, 0), 'Job 绑定失败时也必须终止已启动的 PowerShell');
  } finally {
    if (workerPid) { try { process.kill(workerPid); } catch {} }
    assert.ok(base.startsWith(path.join(tmpdir(), 'keeplive failed job ')));
    await rm(base, { recursive: true, force: true });
  }
});

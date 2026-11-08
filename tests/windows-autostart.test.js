import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Windows background runner restarts, refuses duplicates and owns child shutdown',{skip:process.platform!=='win32',timeout:30000},async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-autostart-')),project=path.join(base,'album with spaces');await mkdir(path.join(project,'server'),{recursive:true});
  const count=path.join(project,'starts.txt'),log=path.join(project,'.data/logs/autostart.log');
  await writeFile(path.join(project,'server/index.js'),`const fs=require('node:fs');const path=require('node:path');const count=path.join(__dirname,'../starts.txt');const first=!fs.existsSync(count);fs.appendFileSync(count,process.pid+'\\n');console.log('started');if(first){const descendant=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',windowsHide:true});fs.writeFileSync(path.join(__dirname,'../descendant.txt'),String(descendant.pid));setTimeout(()=>process.exit(17),150);}else setInterval(()=>{},1000);`);
  const runner=fileURLToPath(new URL('../deploy/windows/run-keeplive.ps1',import.meta.url));
  const args=['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned','-WindowStyle','Hidden','-File',runner,'-ProjectPath',project,'-NodePath',process.execPath];
  const child=spawn('powershell.exe',args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let errors='';child.stderr.on('data',chunk=>{errors+=chunk;});child.stdout.resume();
  const exited=new Promise(resolve=>child.once('exit',resolve));
  async function waitFor(predicate,requireRunner=true){const deadline=Date.now()+20000;while(Date.now()<deadline){if(await predicate())return;if(requireRunner)assert.equal(child.exitCode,null,errors);await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('Background runner condition timed out: '+errors);}
  const starts=async()=>{try{return (await readFile(count,'utf8')).trim().split('\n').filter(Boolean);}catch{return [];}};
  try{
    await waitFor(async()=>(await starts()).length===2);
    assert.match(await readFile(log,'utf8'),/Node exited with code 17/);
    const descendantPid=Number(await readFile(path.join(project,'descendant.txt'),'utf8'));
    assert.throws(()=>process.kill(descendantPid,0),'Exited worker descendants must be reaped before restarting');
    const duplicate=spawnSync('powershell.exe',args,{windowsHide:true,timeout:5000});assert.equal(duplicate.status,0,duplicate.stderr?.toString());
    assert.equal((await starts()).length,2);
    const alivePid=Number((await starts())[1]);assert.doesNotThrow(()=>process.kill(alivePid,0));
    const inspect=path.join(base,'inspect-console.ps1');
    await writeFile(inspect,`param([uint32]$TargetPid)
Add-Type 'using System; using System.Runtime.InteropServices; public static class ProbeConsole { [DllImport("kernel32.dll",SetLastError=true)] public static extern bool AttachConsole(uint pid); [DllImport("kernel32.dll")] public static extern bool FreeConsole(); [DllImport("kernel32.dll")] public static extern IntPtr GetConsoleWindow(); }'
[ProbeConsole]::FreeConsole() | Out-Null
if([ProbeConsole]::AttachConsole($TargetPid)){$window=[ProbeConsole]::GetConsoleWindow();[ProbeConsole]::FreeConsole() | Out-Null;if($window -ne [IntPtr]::Zero){exit 1};exit 0}
if([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 6){exit 2}
exit 0
`);
    const consoleCheck=spawnSync('powershell.exe',['-NoProfile','-File',inspect,'-TargetPid',String(alivePid)],{windowsHide:true});
    assert.equal(consoleCheck.status,0,'Real Node must not acquire a console window during startup');
    child.kill();await exited;
    await waitFor(async()=>{try{process.kill(alivePid,0);return false;}catch{return true;}},false);
  }finally{
    if(child.exitCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});await exited;
    await rm(base,{recursive:true,force:true});
  }
});

// Removing CreateNoWindow must fail this real native-console probe.
test('photo runner creates no console and streams logs while running',{skip:process.platform!=='win32',timeout:30000},async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive photo console '));
  const project=path.join(base,'photo project');await mkdir(path.join(project,'server'),{recursive:true});
  await writeFile(path.join(project,'server/index.js'),'// native probe replaces Node for this test');
  const source=path.join(base,'Probe.cs'),exe=path.join(base,'node probe.exe'),marker=path.join(base,'marker.txt');
  await writeFile(source,`using System; using System.IO; using System.Diagnostics; using System.Runtime.InteropServices; using System.Threading;
class Probe { [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow(); static void Main(string[] args) {
string marker=Environment.GetEnvironmentVariable("KEEP_PHOTO_MARKER");
if(args[0]=="--descendant"){Console.WriteLine("descendant");Thread.Sleep(Timeout.Infinite);return;}
bool first=!File.Exists(marker);
File.WriteAllText(marker,Process.GetCurrentProcess().Id+"|"+GetConsoleWindow().ToInt64()+"|"+args[0]);
Console.WriteLine("live output");Console.Error.WriteLine("live error");
if(first){var info=new ProcessStartInfo(Process.GetCurrentProcess().MainModule.FileName,"--descendant");info.UseShellExecute=false;info.CreateNoWindow=true;var descendant=Process.Start(info);File.WriteAllText(marker+".descendant",descendant.Id.ToString());Thread.Sleep(1000);Environment.Exit(17);}
Thread.Sleep(Timeout.Infinite); } }`);
  const compile=path.join(base,'compile.ps1');await writeFile(compile,'param($Source,$Output)\nAdd-Type -Path $Source -OutputAssembly $Output -OutputType ConsoleApplication\n');
  const flags=['-NoProfile','-NonInteractive','-ExecutionPolicy','RemoteSigned'];
  const built=spawnSync('powershell.exe',[...flags,'-File',compile,'-Source',source,'-Output',exe],{windowsHide:true,timeout:15000});
  assert.equal(built.status,0,built.stderr?.toString());
  const runner=fileURLToPath(new URL('../deploy/windows/run-keeplive.ps1',import.meta.url));
  const child=spawn('powershell.exe',[...flags,'-File',runner,'-ProjectPath',project,'-NodePath',exe],{windowsHide:true,env:{...process.env,KEEP_PHOTO_MARKER:marker},stdio:'ignore'});
  const exited=new Promise(resolve=>child.once('exit',resolve));let probePid;
  async function waitFor(read){const deadline=Date.now()+12000;while(Date.now()<deadline){const value=await read();if(value)return value;await new Promise(r=>setTimeout(r,100));}throw new Error('Photo probe timed out');}
  try{
    const seen=await waitFor(async()=>{try{return await readFile(marker,'utf8');}catch{return null;}});
    const [pid,handle,entry]=seen.split('|');probePid=Number(pid);
    assert.equal(handle,'0','Photo process must not allocate a console');
    assert.equal(entry,path.join(project,'server/index.js'));
    await waitFor(async()=>{try{return (await readFile(path.join(project,'.data/logs/server.log'),'utf8')).includes('live output')&&(await readFile(path.join(project,'.data/logs/server-error.log'),'utf8')).includes('live error');}catch{return false;}});
    assert.equal(child.exitCode,null);
    await waitFor(async()=>{try{return (await readFile(path.join(project,'.data/logs/autostart.log'),'utf8')).includes('Node exited with code 17')&&(await readFile(marker,'utf8')).split('|')[0]!==String(probePid);}catch{return false;}});
    const descendantPid=Number(await readFile(marker+'.descendant','utf8'));
    assert.throws(()=>process.kill(descendantPid,0),'Native descendants retaining output pipes must be reaped');
    child.kill();await exited;
    await waitFor(async()=>{try{process.kill(probePid,0);return false;}catch{return true;}});
  }finally{
    if(child.exitCode===null)spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{windowsHide:true});await exited;
    if(probePid){try{process.kill(probePid);}catch{}}
    assert.ok(base.startsWith(path.join(tmpdir(),'keeplive photo console ')));
    await rm(base,{recursive:true,force:true});
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('boot conversion removes login dependency without changing account, actions or settings',{skip:process.platform!=='win32'},async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive boot xml '));
  try{
    const check=path.join(base,'check.ps1');
    await writeFile(check,`param($Script)
$ErrorActionPreference='Stop'
. $Script
$xml='<Task xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers><LogonTrigger><Enabled>true</Enabled><UserId>fixture</UserId></LogonTrigger></Triggers><Principals><Principal id="Author"><UserId>fixture</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy></Settings><Actions Context="Author"><Exec><Command>C:\\folder with spaces\\launcher.exe</Command><Arguments>"photo.ps1"</Arguments></Exec></Actions></Task>'
$result=[xml](ConvertTo-KeepliveBootTaskXml -Xml $xml)
if(@($result.Task.Triggers.ChildNodes).Count -ne 1 -or $result.Task.Triggers.FirstChild.LocalName -ne 'BootTrigger'){throw 'Expected only boot trigger'}
if($result.Task.Triggers.BootTrigger.Delay -ne 'PT30S'){throw 'Expected boot delay'}
if($result.Task.Principals.Principal.LogonType -ne 'Password'){throw 'Must run without interactive login'}
if($result.Task.Principals.Principal.UserId -ne 'fixture' -or $result.Task.Principals.Principal.RunLevel -ne 'LeastPrivilege'){throw 'Identity or privilege changed'}
$original=[xml]$xml
if($result.Task.Actions.OuterXml -ne $original.Task.Actions.OuterXml -or $result.Task.Settings.OuterXml -ne $original.Task.Settings.OuterXml){throw 'Existing action/settings changed'}
if((ConvertTo-KeepliveBootTaskXml -Xml $result.OuterXml) -ne $result.OuterXml){throw 'Conversion must be idempotent'}
`);
    const script=fileURLToPath(new URL('../deploy/windows/enable-boot-startup.ps1',import.meta.url));
    const result=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-File',check,'-Script',script],{windowsHide:true,timeout:15000});
    assert.equal(result.status,0,result.stderr?.toString());
  }finally{assert.ok(base.startsWith(path.join(tmpdir(),'keeplive boot xml ')));await rm(base,{recursive:true,force:true});}
});

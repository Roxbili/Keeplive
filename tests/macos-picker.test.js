import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {NativeDirectoryPicker} from '../server/native-directory.js';

test('macOS enables a native picker while unsupported platforms keep the web picker',()=>{
  assert.equal(new NativeDirectoryPicker({platform:'darwin'}).supported,true);
  assert.equal(new NativeDirectoryPicker({platform:'linux'}).supported,false);
});

test('Mac folder paths remain environment data and picker cancellation permits another attempt',async()=>{
  const initial="/Volumes/照片 单引号'\n$(touch should-not-run); \"相册\"";
  let answer={path:initial,canceled:false},invocation;
  const picker=new NativeDirectoryPicker({platform:'darwin',supported:true,async run(command,args,options){
    invocation={command,args,options};
    if(answer instanceof Error)throw answer;
    return {stdout:JSON.stringify(answer)};
  }});
  try{
    assert.equal(await picker.pick(initial),initial);
    assert.equal(invocation.command,'/usr/bin/osascript');
    assert.deepEqual(invocation.args,['-l','JavaScript',fileURLToPath(new URL('../server/native-directory-macos.js',import.meta.url))]);
    assert.equal(invocation.options.env.KEEPLIVE_PICKER_INITIAL,initial);
    assert.equal(invocation.args.includes(initial),false);
    answer={path:null,canceled:true};assert.equal(await picker.pick(initial),null);
    answer=Error('desktop unavailable');await assert.rejects(picker.pick(initial),error=>error.status===409);
    answer={path:initial,canceled:false};assert.equal(await picker.pick(initial),initial);
  }finally{await picker.close();}
});

test('Windows still invokes its fixed PowerShell script',async()=>{
  let command,args;
  const picker=new NativeDirectoryPicker({platform:'win32',supported:true,async run(executable,arguments_){command=executable;args=arguments_;return {stdout:JSON.stringify({path:'C:\\Photos',canceled:false})};}});
  try{
    assert.equal(await picker.pick('C:\\Photos'),'C:\\Photos');
    assert.match(command,/powershell\.exe$/i);
    assert.ok(args.includes('-EncodedCommand'));
  }finally{await picker.close();}
});

test('the Mac panel uses real AppKit folder-only settings and preserves unusual initial paths',{skip:process.platform!=='darwin'},async()=>{
  const base=await mkdtemp(path.join(await realpath(tmpdir()),'keeplive-mac-panel-'));
  const initial=path.join(base,"照片 ' $()\n相册");await mkdir(initial);
  try{
    const script=await readFile(new URL('../server/native-directory-macos.js',import.meta.url),'utf8');
    const probe=path.join(base,'panel-probe.js');
    // Exercise panel configuration with AppKit without showing a modal window.
    await writeFile(probe,script+`\nfunction run(){
      var initial=ObjC.unwrap($.NSProcessInfo.processInfo.environment.objectForKey('KEEPLIVE_PICKER_INITIAL'));
      var panel=createFolderPanel(initial);
      return JSON.stringify({directories:panel.canChooseDirectories,files:panel.canChooseFiles,multiple:panel.allowsMultipleSelection,create:panel.canCreateDirectories,packages:panel.treatsFilePackagesAsDirectories,initial:ObjC.unwrap(panel.directoryURL.path)});
    }\n`);
    const {stdout}=await promisify(execFile)('/usr/bin/osascript',['-l','JavaScript',probe],{env:{...process.env,KEEPLIVE_PICKER_INITIAL:initial},timeout:15000});
    assert.deepEqual(JSON.parse(stdout.trim()),{directories:true,files:false,multiple:false,create:false,packages:false,initial});
  }finally{await rm(base,{recursive:true,force:true});}
});

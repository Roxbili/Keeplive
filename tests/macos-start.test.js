import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,copyFile,symlink,readFile,access,realpath,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {createApp} from '../server/app.js';

async function fixture(){
  const base=await mkdtemp(path.join(await realpath(tmpdir()),'keeplive-mac-start-'));
  const project=path.join(base,'照片 项目'),bin=path.join(base,'runtime bin');
  await mkdir(project);await mkdir(bin);await mkdir(path.join(project,'server'));
  await mkdir(path.join(project,'deploy/macos'),{recursive:true});
  await copyFile(new URL('../start-keeplive.command',import.meta.url),path.join(project,'start-keeplive.command'));
  await copyFile(new URL('../deploy/macos/already-running.js',import.meta.url),path.join(project,'deploy/macos/already-running.js'));
  await symlink(process.execPath,path.join(bin,'node'));
  const npm=await realpath(path.join(path.dirname(process.execPath),'npm'));await symlink(npm,path.join(bin,'npm'));
  const record=file=>`require('node:fs').writeFileSync('${file}',JSON.stringify({cwd:process.cwd(),version:process.versions.node}))`;
  const pkg={name:'keeplive-launch-fixture',version:'1.0.0',private:true,scripts:{preinstall:`node -e "${record('installed.json')}"`,build:`node -e "${record('built.json')}"`}};
  await writeFile(path.join(project,'package.json'),JSON.stringify(pkg));
  await writeFile(path.join(project,'package-lock.json'),JSON.stringify({name:pkg.name,version:pkg.version,lockfileVersion:3,requires:true,packages:{'':{name:pkg.name,version:pkg.version,hasInstallScript:true}}}));
  await writeFile(path.join(project,'server/index.js'),record('started.json'));
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening');
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  const env={...process.env,KEEPLIVE_NODE:path.join(bin,'node'),HOST:'127.0.0.1',PORT:String(port),npm_config_audit:'false',npm_config_fund:'false',npm_config_ignore_scripts:'false'};
  return {base,project,env,run:()=>promisify(execFile)('/bin/zsh',[path.join(project,'start-keeplive.command')],{cwd:base,env,timeout:30000}),async close(){await rm(base,{recursive:true,force:true});}};
}

test('Mac launcher installs, builds and starts with the selected Node in a path containing spaces',{skip:process.platform!=='darwin'},async()=>{
  const f=await fixture();
  try{
    await f.run();
    for(const name of ['installed.json','built.json','started.json']){
      const result=JSON.parse(await readFile(path.join(f.project,name),'utf8'));
      assert.equal(result.cwd,f.project);assert.ok(Number(result.version.split('.')[0])>=24);
    }
  }finally{await f.close();}
});

test('an unusable explicit Node override fails before installing or starting',{skip:process.platform!=='darwin'},async()=>{
  const f=await fixture();f.env.KEEPLIVE_NODE='/usr/bin/false';
  try{
    await assert.rejects(f.run(),error=>error.code===1&&/Node\.js 24/.test(error.stderr+error.stdout));
    for(const name of ['installed.json','built.json','started.json'])await assert.rejects(access(path.join(f.project,name)));
  }finally{await f.close();}
});

test('opening the Mac launcher again reuses a running Keeplive without rebuilding',{skip:process.platform!=='darwin'},async()=>{
  const f=await fixture(),runtime=createApp({dataDir:path.join(f.base,'data')});
  const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');f.env.PORT=String(server.address().port);
  try{
    const {stdout}=await f.run();assert.match(stdout,/已在运行/);
    for(const name of ['installed.json','built.json','started.json'])await assert.rejects(access(path.join(f.project,name)));
  }finally{await new Promise(resolve=>server.close(resolve));await runtime.close();await f.close();}
});

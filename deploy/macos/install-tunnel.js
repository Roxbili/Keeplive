import { execFileSync,spawnSync } from 'node:child_process';
import { accessSync,constants,existsSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,statSync,writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const label='com.roxbili.keeplive.tunnel';

function xmlText(value){
  return value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
}

function install(){
  if(process.platform!=='darwin')throw new Error('这个安装脚本需要在 macOS 上运行');
  const project=path.resolve(fileURLToPath(new URL('../../',import.meta.url)));
  const home=homedir();
  const key=path.join(home,'.ssh/keeplive_tunnel_ed25519');
  if(!existsSync(key)||!statSync(key).isFile())throw new Error(`请先准备隧道密钥并将公钥授权到服务器：${key}`);
  accessSync(key,constants.R_OK);

  const template=readFileSync(new URL('./keeplive-tunnel.plist',import.meta.url),'utf8');
  const rendered=template.replaceAll('{{PROJECT_ROOT}}',()=>xmlText(project)).replaceAll('{{HOME}}',()=>xmlText(home));
  const directory=path.join(home,'Library/LaunchAgents');
  const agent=path.join(directory,label+'.plist');
  const domain=`gui/${process.getuid()}`;
  const service=`${domain}/${label}`;
  mkdirSync(directory,{recursive:true});
  mkdirSync(path.join(project,'.data/logs'),{recursive:true});
  const previous=existsSync(agent)?readFileSync(agent):null;
  const loaded=spawnSync('/bin/launchctl',['print',service],{stdio:'ignore'}).status===0;
  if(previous?.equals(Buffer.from(rendered))&&loaded){
    console.log('SSH 隧道自动重连已安装并加载');
    return;
  }

  const temporary=mkdtempSync(path.join(directory,'.keeplive-tunnel-'));
  const staged=path.join(temporary,label+'.plist');
  try{
    writeFileSync(staged,rendered,{mode:0o600});
    execFileSync('/usr/bin/plutil',['-lint',staged],{stdio:'pipe'});
    if(loaded)execFileSync('/bin/launchctl',['bootout',service],{stdio:'inherit'});
    try{
      renameSync(staged,agent);
      execFileSync('/bin/launchctl',['bootstrap',domain,agent],{stdio:'inherit'});
    }catch(error){
      if(previous)writeFileSync(agent,previous,{mode:0o600});
      else rmSync(agent,{force:true});
      if(loaded){
        try{execFileSync('/bin/launchctl',['bootstrap',domain,agent],{stdio:'inherit'});}
        catch(restoreError){console.error('原隧道任务恢复失败：',restoreError.message);}
      }
      throw error;
    }
    console.log('已安装 SSH 隧道自动重连，登录后自动启动');
    console.log(`任务状态可用 launchctl print ${service} 查看`);
  }finally{
    rmSync(temporary,{recursive:true,force:true});
  }
}

try{install();}
catch(error){console.error('无法安装 SSH 隧道自动重连：',error.message);process.exitCode=1;}

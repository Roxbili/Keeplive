import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const unavailable=message=>Object.assign(new Error(message),{status:409});
export class NativeDirectoryPicker {
  constructor({supported=process.platform==='win32'&&process.env.SESSIONNAME!=='Services',run=promisify(execFile)}={}){
    this.supported=supported;this.run=run;this.pending=null;this.controller=null;this.closed=false;
  }
  async pick(initial='',{signal}={}){
    if(!this.supported||this.closed)throw unavailable('系统文件夹选择不可用，请使用网页选择');
    if(this.pending)throw unavailable('已有文件夹选择窗口打开，请先完成或取消');
    const controller=new AbortController(),abort=()=>controller.abort();this.controller=controller;
    signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
    const pending=this.open(initial,controller.signal);this.pending=pending;
    try{return await pending;}finally{signal?.removeEventListener('abort',abort);if(this.pending===pending){this.pending=null;this.controller=null;}}
  }
  async open(initial,signal){
    try{
      const script=await readFile(new URL('./native-directory.ps1',import.meta.url),'utf8');
      const command=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
      const {stdout}=await this.run(command,['-NoLogo','-NoProfile','-STA','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{
        windowsHide:true,encoding:'utf8',timeout:180000,maxBuffer:65536,signal,env:{...process.env,KEEPLIVE_PICKER_INITIAL:initial}
      });
      const result=JSON.parse(stdout.trim());
      if(result.canceled===true)return null;
      if(typeof result.path!=='string'||!result.path)throw new Error('Invalid directory result');
      return result.path;
    }catch{throw unavailable('暂时无法打开系统窗口，请使用网页选择文件夹');}
  }
  async close(){this.closed=true;this.controller?.abort();await this.pending?.catch(()=>{});}
}

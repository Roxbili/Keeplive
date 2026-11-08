import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { AutoSync } from './auto-sync.js';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
try{process.loadEnvFile(path.join(project,'.env'));}catch(error){if(error.code!=='ENOENT')throw error;}
const runtime=createApp();const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT)||3210;
const autoSync=new AutoSync(runtime.store,runtime.library,{pollIntervalMs:Math.max(60,Number(process.env.SCAN_INTERVAL_SECONDS)||60)*1000});
const server=runtime.app.listen(port,host,()=>{
  console.log(`\nKeeplive 已启动：http://${host}:${port}`);
  if(!runtime.store.users.count())console.log('首次使用：请在这台电脑打开本地页面，创建管理员账号。');
  void autoSync.start();
});
server.on('error',error=>{console.error('无法启动相册：',error.message);void autoSync.close().then(()=>runtime.close()).then(()=>process.exit(1));});
let closing=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(closing)return;closing=true;server.close(async()=>{await autoSync.close();await runtime.close();process.exit(0);});void runtime.nativePicker.close();});

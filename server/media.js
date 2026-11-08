import path from 'node:path';
import { mkdir,stat,rename,rm } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { spawn } from 'node:child_process';
import { createWriteStream,createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import ffmpeg from 'ffmpeg-static';
import { resolveInside } from './paths.js';
import { defaultPlayback,isVideoQuality } from './playback.js';

const exists=async file=>{try{return (await stat(file)).isFile();}catch{return false;}};
export async function bundle(files,output){
  const details=await Promise.all(files.map(async file=>({...file,info:await stat(file.path)})));
  const zip=new ZipFile(),readers=new Set();zip.on('error',error=>zip.outputStream.destroy(error));
  const complete=pipeline(zip.outputStream,createWriteStream(output,{flags:'wx',mode:0o600}));
  try{for(const file of details){if(!file.info.isFile())throw new Error('实况原文件暂时不可读取');zip.addReadStreamLazy(file.name,{compress:false,mode:0o100644,mtime:file.info.mtime,size:file.info.size},callback=>{
      const stream=createReadStream(file.path);readers.add(stream);stream.once('close',()=>readers.delete(stream));callback(null,stream);
    });}zip.end();await complete;}
  catch(error){zip.outputStream.destroy(error);await complete.catch(()=>{});throw error;}
  finally{for(const stream of readers)stream.destroy();}
}

function runFFmpeg(args){return new Promise((resolve,reject)=>{
  const child=spawn(process.env.FFMPEG_PATH||ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-y',...args],{windowsHide:true});
  let error='';const timer=setTimeout(()=>{child.kill();reject(new Error('视频处理超时，请重试或检查文件'));},10*60*1000);
  child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-2000);});
  child.on('error',e=>{clearTimeout(timer);reject(e);});child.on('close',code=>{clearTimeout(timer);code===0?resolve():reject(new Error(`视频转换失败：${error.slice(-300)}`));});
});}

function image(input,output,size){return new Promise((resolve,reject)=>{
  const worker=new Worker(new URL('./image-worker.js',import.meta.url),{workerData:{input,output,size}});
  const timer=setTimeout(()=>{worker.terminate();reject(new Error('图像处理超时'));},120_000);
  worker.once('message',result=>{clearTimeout(timer);result.error?reject(new Error(`图像转换失败：${result.error}`)):resolve();});
  worker.once('error',error=>{clearTimeout(timer);reject(error);});
  worker.once('exit',code=>{clearTimeout(timer);if(code!==0)reject(new Error('图像处理意外中断'));});
});}

export class Media {
  constructor(store){this.store=store;this.cache=path.join(store.dataDir,'cache');this.pending=new Map();this.warmVersions=new Map();this.tail=Promise.resolve();this.closing=false;}
  async get(id,variant,quality=defaultPlayback.videoQuality){
    const asset=this.store.asset(id);if(!asset)throw Object.assign(new Error('照片不存在'),{status:404});
    if(!['thumb','preview','video','original','motion-original','download'].includes(variant))throw Object.assign(new Error('未知素材类型'),{status:404});
    if(variant==='download'){if(asset.kind==='live')return this.downloadLive(asset);variant='original';}
    if(variant==='original' || variant==='motion-original'){
      const relative=variant==='motion-original'?asset.video?.relative:asset.relative;
      if(!relative)throw Object.assign(new Error('没有对应的视频原文件'),{status:404});
      return {file:await resolveInside(asset.sourcePath,relative),download:path.posix.basename(relative)};
    }
    if(variant==='video' && !['live','video'].includes(asset.kind))throw Object.assign(new Error('这张照片没有动态内容'),{status:404});
    if(variant==='video'&&!isVideoQuality(quality))throw Object.assign(new Error('播放清晰度不正确'),{status:400});
    // Versioned, separate renditions prevent reuse of the former fixed 1280px cache.
    const rendition=variant==='video'?`video-v2-${quality}`:variant;
    const file=path.join(this.cache,`${id}-${asset.version}-${rendition}.${variant==='video'?'mp4':'jpg'}`);
    if(await exists(file))return {file};
    if(this.pending.has(file))return this.pending.get(file);
    if(this.pending.size>80)throw Object.assign(new Error('正在处理较多素材，请稍后重试'),{status:429});
    const job=this.tail.then(async()=>{
      await mkdir(this.cache,{recursive:true});const temp=file.replace(/\.(jpg|mp4)$/,'-pending.$1');
      try{
        const input=await resolveInside(asset.sourcePath,variant==='video'&&asset.video?asset.video.relative:asset.relative);
        if(variant==='video'){
          const cap=quality==='high'?1920:1280;
          // Original keeps all source pixels; pad odd dimensions for H.264 compatibility.
          // Other profiles cap the longest edge without enlarging smaller sources.
          const filter=quality==='original'?'pad=ceil(iw/2)*2:ceil(ih/2)*2':`scale=w='max(2,trunc(iw*min(1,${cap}/max(iw,ih))/2)*2)':h='max(2,trunc(ih*min(1,${cap}/max(iw,ih))/2)*2)'`;
          await runFFmpeg(['-i',input,'-map','0:v:0','-map','0:a?','-vf',filter,'-c:v','libx264','-preset','fast','-crf',quality==='original'?'18':quality==='high'?'20':'23','-pix_fmt','yuv420p','-c:a','aac','-b:a',quality==='smooth'?'128k':'192k','-movflags','+faststart',temp]);
        }else if(asset.kind==='video'){
          await runFFmpeg(['-i',input,'-frames:v','1','-vf',`scale=${variant==='thumb'?480:1920}:${variant==='thumb'?480:1920}:force_original_aspect_ratio=decrease`,'-q:v','3',temp]);
        }else await image(input,temp,variant==='thumb'?480:2400);
        await rename(temp,file);return {file};
      }catch(error){await rm(temp,{force:true}).catch(()=>{});throw error;}
    });
    this.pending.set(file,job);this.tail=job.catch(()=>{});
    job.finally(()=>this.pending.delete(file)).catch(()=>{});return job;
  }
  async downloadLive(asset){
    if(!asset.video?.relative)throw Object.assign(new Error('实况视频原文件暂时不可读取'),{status:503});
    // Even a cached bundle requires both confined originals to remain available.
    const files=[];for(const relative of [asset.relative,asset.video.relative]){
      const input=await resolveInside(asset.sourcePath,relative);if(!(await stat(input)).isFile())throw Object.assign(new Error('实况原文件暂时不可读取'),{status:503});
      files.push({path:input,name:path.posix.basename(relative)});
    }
    const download=path.posix.parse(asset.filename).name+'-live.zip',file=path.join(this.cache,`${asset.id}-${asset.version}-live-originals.zip`);
    if(await exists(file))return {file,download};if(this.pending.has(file))return this.pending.get(file);
    if(this.pending.size>80)throw Object.assign(new Error('正在处理较多素材，请稍后重试'),{status:429});
    const job=this.tail.then(async()=>{
      await mkdir(this.cache,{recursive:true});const temp=file+'.pending';
      try{for(let i=0;i<files.length;i++)files[i].path=await resolveInside(asset.sourcePath,i===0?asset.relative:asset.video.relative);await rm(temp,{force:true});await bundle(files,temp);await rename(temp,file);return {file,download};}
      catch(error){await rm(temp,{force:true}).catch(()=>{});throw error;}
    });
    this.pending.set(file,job);this.tail=job.catch(()=>{});job.finally(()=>this.pending.delete(file)).catch(()=>{});return job;
  }
  warm(assets){
    // Keep a bounded background queue so an entire large library cannot delay viewing.
    const remaining=assets.filter(a=>this.warmVersions.get(a.id)!==a.version).map(a=>{this.warmVersions.set(a.id,a.version);return {id:a.id,version:a.version};});
    if(!remaining.length)return;
    const next=async()=>{
      for(const {id,version} of remaining){if(this.closing)return;await new Promise(r=>setTimeout(r,50));try{await this.get(id,'thumb');}catch{if(this.warmVersions.get(id)===version)this.warmVersions.delete(id);}}
    };
    this.warming=(this.warming||Promise.resolve()).then(next);
  }
  async close(){this.closing=true;await this.warming;await this.tail;}
}

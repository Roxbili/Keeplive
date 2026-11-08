import path from 'node:path';
import { readdir, stat,realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { ExifTool } from 'exiftool-vendored';

const photos=new Set(['.jpg','.jpeg','.png','.webp','.heic','.heif','.avif','.tif','.tiff']);
const videos=new Set(['.mov','.mp4','.m4v','.webm']);
const hash=value=>createHash('sha256').update(value).digest('hex').slice(0,24);
const stem=file=>path.posix.join(path.posix.dirname(file.relative),path.posix.parse(file.relative).name.toLowerCase());
const groupBy=(files,key)=>{const groups=new Map(); for(const f of files){const k=key(f);if(k){const g=groups.get(k)||[];g.push(f);groups.set(k,g);}}return groups;};

export function pairMedia(files) {
  const pictures=files.filter(f=>f.kind==='photo'), movies=files.filter(f=>f.kind==='video');
  const pi=groupBy(pictures,f=>f.contentId), vi=groupBy(movies,f=>f.contentId);
  const pn=groupBy(pictures,stem), vn=groupBy(movies,stem);
  const used=new Set(),paired=new Map();
  for(const p of pictures){
    const candidates=vi.get(p.contentId);
    if(p.contentId && pi.get(p.contentId)?.length===1 && candidates?.length===1){paired.set(p,candidates[0]);used.add(candidates[0]);}
  }
  for(const p of pictures){
    if(paired.has(p))continue;
    const key=stem(p), candidates=vn.get(key);
    if(pn.get(key)?.length!==1 || candidates?.length!==1)continue;
    const v=candidates[0];
    if(used.has(v) || (p.contentId && v.contentId && p.contentId!==v.contentId))continue;
    if((p.contentId && (pi.get(p.contentId)?.length>1 || vi.get(p.contentId)?.length>1)) || (v.contentId && (pi.get(v.contentId)?.length>1 || vi.get(v.contentId)?.length>1)))continue;
    paired.set(p,v);used.add(v);
  }
  return [...pictures.map(p=>({...p,video:paired.get(p)})),...movies.filter(v=>!used.has(v))];
}

export async function walk(root,recursive=true) {
  const files=[],errors=[];
  async function visit(dir){
    let entries;try{entries=await readdir(dir,{withFileTypes:true});}catch(e){errors.push(`${path.relative(root,dir)||'.'}: ${e.code}`);return;}
    for(const entry of entries){
      if(entry.isSymbolicLink() || entry.name.startsWith('.'))continue;
      const full=path.join(dir,entry.name);
      if(entry.isDirectory()){if(recursive)await visit(full);continue;}
      if(!entry.isFile())continue;
      const ext=path.extname(entry.name).toLowerCase();
      const kind=photos.has(ext)?'photo':videos.has(ext)?'video':null;
      if(!kind)continue;
      try{const s=await stat(full);files.push({relative:path.relative(root,full).split(path.sep).join('/'),kind,signature:`${s.size}:${s.mtimeMs}`,mtime:s.mtime.toISOString()});}catch(e){errors.push(`${entry.name}: ${e.code}`);}
    }
  }
  await visit(root);return {files,errors};
}

function dateOf(tags,fallback){
  for(const value of [tags.DateTimeOriginal,tags.CreateDate,tags.MediaCreateDate]){
    try{const d=value?.toDate?.() ?? (typeof value==='string'?new Date(value):null);if(d && Number.isFinite(d.getTime()) && d.getFullYear()>1970)return d.toISOString();}catch{}
  }
  return fallback;
}

export class Library {
  constructor(store){this.store=store;this.exif=new ExifTool({maxProcs:2});this.job=this.emptyJob();this.jobs=new Map();this.pending=new Map();this.current=null;this.onAssets=null;}
  emptyJob(){return {running:false,processed:0,total:0,error:null,finishedAt:null};}
  getJob(userId){return this.jobs.get(userId)||this.emptyJob();}
  exclusive(work){const task=(this.current||Promise.resolve()).catch(()=>{}).then(work).finally(()=>{if(this.current===task){this.current=null;this.job.running=false;}});this.current=task;this.job.running=true;return task;}
  scan(userId){
    if(this.pending.has(userId))return this.pending.get(userId);
    if(userId!==undefined&&this.getJob(userId).running)return this.current;
    if(userId===undefined&&this.current)return this.current;
    const sources=this.store.sources(userId),owners=[...new Set(sources.map(s=>s.ownerId))];if(userId!==undefined&&!owners.includes(userId))owners.push(userId);
    for(const owner of owners)this.jobs.set(owner,{...this.emptyJob(),running:true});
    this.job.running=true;
    const previous=this.current;
    const promise=(previous||Promise.resolve()).then(()=>this.run(sources)).catch(error=>{for(const owner of owners)this.getJob(owner).error=error.message;}).finally(()=>{
      for(const owner of owners){const job=this.getJob(owner);job.running=false;job.finishedAt=new Date().toISOString();}
      this.pending.delete(userId);if(this.current===promise){this.current=null;this.job.running=false;}
    });
    this.current=promise;this.pending.set(userId,promise);return promise;
  }
  async run(sources){
    for(const source of sources){
      const job=this.getJob(source.ownerId);
      try{if(!(await stat(source.path)).isDirectory()||path.relative(path.resolve(source.path),await realpath(source.path))!=='')throw new Error('不是原文件夹');}catch{this.store.sourceStatus(source.id,'offline','目录不可访问，请连接硬盘或重新定位');continue;}
      this.store.sourceStatus(source.id,'scanning');
      const {files,errors}=await walk(source.path,source.recursive); job.total+=files.length;
      const trashed=this.store.trashedFiles(source.id);
      const indexed=[];
      for(const file of files){
        if(trashed.has(file.relative))continue;
        let metadata=this.store.metadata(source.id,file.relative,file.signature);
        if(!metadata){
          let tags={},readOK=true;try{
            tags=await this.exif.read(path.join(source.path,file.relative));
            if(tags.errors?.length || tags.Error || (tags.MIMEType && !/^(image|video)\//.test(tags.MIMEType)))throw new Error('媒体信息不可读取');
          }catch(e){readOK=false;errors.push(`${file.relative}: 无法读取拍摄信息`);}
          metadata={...file,contentId:tags.ContentIdentifier?String(tags.ContentIdentifier):undefined,takenAt:dateOf(tags,file.mtime),width:Number(tags.ImageWidth)||0,height:Number(tags.ImageHeight)||0,duration:typeof tags.Duration==='number'?tags.Duration:0};
          if(readOK)this.store.saveMetadata(source.id,metadata);
        }
        indexed.push(metadata);job.processed++;
      }
      const assets=pairMedia(indexed).map(file=>({...file,id:hash(`${source.id}:${file.relative}`),sourceId:source.id,folder:path.posix.dirname(file.relative)==='.'?'':path.posix.dirname(file.relative),filename:path.posix.basename(file.relative),kind:file.video?'live':file.kind,version:hash(`${file.signature}:${file.video?.signature||''}`)}));
      this.store.saveAssets(source.id,assets,errors.length===0);
      this.store.sourceStatus(source.id,errors.length?'partial':'online',errors.length?`${errors.length} 项未完全读取；已保留旧记录。${errors.slice(0,3).join('；')}`:null);
      this.onAssets?.(assets);
    }
  }
  async close(){if(this.current)await this.current.catch(()=>{});await this.exif.end();}
}

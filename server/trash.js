import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,lstat,realpath,rename,writeFile,link,unlink,copyFile,utimes} from 'node:fs/promises';
import {constants,createReadStream} from 'node:fs';
import {resolveInside} from './paths.js';
import {userError} from './users.js';

const signature=info=>`${info.size}:${info.mtimeMs}`;
const pathKey=file=>process.platform==='win32'?path.resolve(file).toLowerCase():path.resolve(file);
async function digest(file){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
export class PhotoTrash {
  constructor(store,library){this.store=store;this.library=library;this.moveFile=rename;this.linkFile=link;this.unlinkFile=unlink;this.copyFile=copyFile;this.utimesFile=utimes;}
  journal(row){this.store.db.prepare('UPDATE photo_trash SET payload=? WHERE id=?').run(JSON.stringify(row.payload),row.id);}
  aliasIndex(ownerId){
    // One indexed read per batch, rather than rescanning the whole album for every selection.
    const rows=this.store.db.prepare('SELECT a.payload,s.path sourcePath,s.name sourceName,EXISTS(SELECT 1 FROM user_favorites f WHERE f.assetId=a.id AND f.userId=?) favorite FROM assets a JOIN sources s ON s.id=a.sourceId WHERE s.ownerId=?').all(ownerId,ownerId),index=new Map();
    for(const row of rows){const asset={...JSON.parse(row.payload),sourcePath:row.sourcePath,sourceName:row.sourceName,favorite:!!row.favorite};
      for(const relative of [asset.relative,asset.video?.relative].filter(Boolean)){const key=pathKey(path.join(asset.sourcePath,relative));if(!index.has(key))index.set(key,[]);index.get(key).push(asset);}
    }
    return index;
  }
  get(id,ownerId){const row=this.store.db.prepare('SELECT * FROM photo_trash WHERE id=? AND ownerId=?').get(id,ownerId);if(!row)throw userError(404,'回收记录不存在');return {...row,payload:JSON.parse(row.payload)};}
  list(ownerId){return {items:this.store.db.prepare('SELECT * FROM photo_trash WHERE ownerId=? ORDER BY deletedAt DESC,id').all(ownerId).map(row=>{const data=JSON.parse(row.payload),source=this.store.source(row.sourceId,ownerId);return {id:row.id,filename:data.asset.filename,kind:data.asset.kind,sourceName:data.asset.sourceName,deletedAt:row.deletedAt,interrupted:row.state!=='ready',available:!!source&&source.status!=='offline'};})};}
  async source(sourceId,ownerId){const source=this.store.source(sourceId,ownerId);if(!source)throw userError(409,'原照片来源已移除，请先重新连接该来源');await this.store.users.assertSource(ownerId,source.path);if(path.relative(source.path,await realpath(source.path))!=='')throw userError(409,'照片目录位置已变化，请先重新定位');return source;}
  async file(root,relative,optional=false){
    const expected=path.resolve(root,relative);let info;
    try{info=await lstat(expected);}catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
    if(!info.isFile()||info.isSymbolicLink())throw userError(409,'文件位置已变化，请重新扫描后再操作');
    const actual=await resolveInside(root,relative);if(path.relative(expected,actual)!=='')throw userError(409,'文件位置已变化，请重新扫描后再操作');return {path:actual,info};
  }
  async directory(root,relative){
    let current=root;
    for(const part of relative.split(/[\\/]/).filter(Boolean)){
      if(part==='.'||part==='..')throw userError(400,'非法回收路径');
      current=path.join(current,part);
      try{await mkdir(current);}catch(error){if(error.code!=='EEXIST')throw error;}
      const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink()||path.relative(current,await realpath(current))!=='')throw userError(409,'回收目录或原目录位置已变化');
    }
  }
  async move(ownerId,ids,authorize){
    if(!Array.isArray(ids)||!ids.length||ids.length>1000||ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id)))throw userError(400,'每次请选择 1 至 1000 项照片');
    const unique=[...new Set(ids)];
    return this.library.exclusive(async()=>{
      authorize();for(const id of unique)if(!this.store.asset(id,ownerId))throw userError(404,'有照片不存在或不属于你的相册，请重新选择');
      const aliases=this.aliasIndex(ownerId);
      const moved=[],failures=[],removed=new Set(),completed=new Set();
      for(const id of unique){let journalId;
        try{
          if(removed.has(id)){if(!completed.has(id))throw userError(409,'同一文件的操作尚未完成，请在回收站恢复');moved.push(id);continue;}
          authorize();const asset=this.store.asset(id,ownerId),source=await this.source(asset.sourceId,ownerId);
          if(this.store.db.prepare('SELECT id FROM photo_trash WHERE assetId=?').get(id))throw userError(409,'这张照片已有回收记录，请先恢复');
          const parts=[{relative:asset.relative,signature:asset.signature},...(asset.video?[{relative:asset.video.relative,signature:asset.video.signature}]:[])];
          for(const part of parts){const current=await this.file(source.path,part.relative);if(signature(current.info)!==part.signature)throw userError(409,'文件已经更新，请重新扫描后再删除');}
          journalId=randomUUID();const files=parts.map((part,i)=>({...part,archived:`.keeplive-trash/${journalId}/${i}-${path.posix.basename(part.relative)}`}));
          await this.directory(source.path,`.keeplive-trash/${journalId}`);
          const matching=new Map();for(const part of parts)for(const alias of aliases.get(pathKey(path.join(source.path,part.relative)))||[])matching.set(alias.id,alias);
          const data={asset,files,aliases:[...matching.values()]},deletedAt=new Date().toISOString();
          // Revoke every indexed alias before moving any bytes, including interrupted moves.
          authorize();this.store.db.exec('BEGIN');try{
            this.store.db.prepare('INSERT INTO photo_trash VALUES (?,?,?,?,?,?,?)').run(journalId,ownerId,asset.sourceId,id,deletedAt,'moving',JSON.stringify(data));
            for(const alias of data.aliases){this.store.db.prepare('DELETE FROM assets WHERE id=?').run(alias.id);removed.add(alias.id);}
            this.store.bumpVersion(ownerId);this.store.db.exec('COMMIT');
          }catch(error){this.store.db.exec('ROLLBACK');throw error;}
          await writeFile(path.join(source.path,'.keeplive-trash',journalId,'manifest.json'),JSON.stringify({id:journalId,deletedAt,filename:asset.filename,files},null,2),{flag:'wx',mode:0o600});
          for(const part of files){authorize();const current=await this.file(source.path,part.relative);if(signature(current.info)!==part.signature)throw userError(409,'文件已经更新，请重新扫描后再删除');await this.moveFile(current.path,path.join(source.path,part.archived));}
          authorize();this.store.db.exec('BEGIN');try{
            this.store.db.prepare('DELETE FROM assets WHERE id=?').run(id);
            this.store.db.prepare("UPDATE photo_trash SET state='ready' WHERE id=?").run(journalId);
            this.store.bumpVersion(ownerId);this.store.db.exec('COMMIT');
          }catch(error){this.store.db.exec('ROLLBACK');throw error;}
          for(const alias of data.aliases)completed.add(alias.id);moved.push(id);
        }catch(error){if(journalId)this.store.db.prepare("UPDATE photo_trash SET state='interrupted' WHERE id=?").run(journalId);if(error.status===401)throw error;failures.push({id,error:error.status?error.message:'操作未完成，请检查硬盘和写入权限；如出现回收记录，可在回收站恢复'});}
      }
      return {moved,removed:[...removed],failures};
    });
  }
  async restore(ownerId,id,authorize){return this.library.exclusive(async()=>{
    authorize();const row=this.get(id,ownerId),source=await this.source(row.sourceId,ownerId),plans=[];
    for(const part of row.payload.files){
      const archived=await this.file(source.path,part.archived,true),original=await this.file(source.path,part.relative,true);
      if(!archived&&!part.restoreStarted&&row.state==='ready')throw userError(409,'回收文件不在这个目录，请重新定位到原硬盘上的照片来源');
      if(archived&&original){
        const sameLink=archived.info.dev===original.info.dev&&archived.info.ino===original.info.ino;
        const sameCopy=part.restoreHash&&await digest(original.path)===part.restoreHash&&await digest(archived.path)===part.restoreHash;
        if(!part.restoreStarted||(!sameLink&&!sameCopy))throw userError(409,'原位置已有同名文件，恢复不会覆盖它，请先处理同名文件');
      }
      if(!archived&&!original)throw userError(409,'有原文件不可读取，请检查硬盘或回收目录');
      if(signature((archived||original).info)!==(archived?part.signature:part.restoredSignature||part.signature))throw userError(409,'文件已经变化，无法安全恢复，请检查回收目录');
      plans.push({part,archived,original});
    }
    for(const {part,archived,original} of plans){if(!archived)continue;
      authorize();await this.directory(source.path,path.posix.dirname(part.relative)==='.'?'':path.posix.dirname(part.relative));
      const destination=path.join(source.path,part.relative);
      // Atomic no-overwrite creation. Prefer a same-volume hard link; exFAT uses exclusive copy.
      part.restoreStarted=true;this.journal(row);
      if(!original){try{await this.linkFile(archived.path,destination);}catch(error){
          if(!['EPERM','ENOTSUP','EOPNOTSUPP','EXDEV'].includes(error.code))throw error;
          part.restoreHash=await digest(archived.path);this.journal(row);
          await this.copyFile(archived.path,destination,constants.COPYFILE_EXCL);
        }
      }
      if(part.restoreHash)await this.utimesFile(destination,archived.info.atimeMs/1000,archived.info.mtimeMs/1000);
      part.restoredSignature=signature(await lstat(destination));this.journal(row);
      await this.unlinkFile(archived.path);
    }
    authorize();const sources=new Map();
    // Restore the indexed snapshot/favorite first, even if a subsequent scan sees a disconnect.
    for(const asset of row.payload.aliases||[row.payload.asset]){
      const current=this.store.source(asset.sourceId,ownerId);if(!current)continue;
      if(current.id!==source.id&&path.relative(current.path,asset.sourcePath)!=='')continue;
      if(current.id!==source.id){try{await this.source(current.id,ownerId);}catch{continue;}}
      authorize();
      this.store.saveAssets(current.id,[asset],false);
      if(asset.favorite)this.store.setFavorite(asset.id,true,ownerId);
      sources.set(current.id,current);
    }
    authorize();this.store.db.prepare('DELETE FROM photo_trash WHERE id=? AND ownerId=?').run(id,ownerId);
    // Already holding the scan lock: run a fresh scan inline, never await a queued scan here.
    await this.library.run([...sources.values()]);
    const restoredId=row.assetId;
    this.store.bumpVersion(ownerId);return {ok:true,id:restoredId};
  });}
}

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Users } from './users.js';

const escapeLike = value => value.replace(/[\\%_]/g, '\\$&');

export class Store {
  constructor(dataDir) {
    this.dataDir = path.resolve(dataDir); mkdirSync(this.dataDir,{recursive:true});
    this.db = new DatabaseSync(path.join(this.dataDir,'keeplive.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY,name TEXT NOT NULL,path TEXT NOT NULL,recursive INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',lastScan TEXT,error TEXT);
      CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY,sourceId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,relative TEXT NOT NULL,folder TEXT NOT NULL,filename TEXT NOT NULL,kind TEXT NOT NULL,takenAt TEXT NOT NULL,favorite INTEGER NOT NULL DEFAULT 0,payload TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS asset_date ON assets(takenAt DESC,id);
      CREATE INDEX IF NOT EXISTS asset_source ON assets(sourceId);
      CREATE TABLE IF NOT EXISTS metadata (sourceId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,relative TEXT NOT NULL,signature TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(sourceId,relative));
      CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,expires INTEGER NOT NULL);`);
    this.users=new Users(this);
    this.db.exec(`CREATE TABLE IF NOT EXISTS photo_trash(id TEXT PRIMARY KEY,ownerId TEXT NOT NULL REFERENCES users(id),sourceId TEXT NOT NULL,assetId TEXT NOT NULL UNIQUE,deletedAt TEXT NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL);CREATE INDEX IF NOT EXISTS photo_trash_owner ON photo_trash(ownerId);`);
  }
  setting(key) { const row=this.db.prepare('SELECT value FROM settings WHERE key=?').get(key); return row ? JSON.parse(row.value) : null; }
  setSetting(key,value) { this.db.prepare('INSERT OR REPLACE INTO settings VALUES (?,?)').run(key,JSON.stringify(value)); }
  sources(userId) { return this.db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM assets WHERE sourceId=s.id) count FROM sources s ${userId===undefined?'':'WHERE ownerId=?'} ORDER BY name`).all(...(userId===undefined?[]:[userId])).map(s=>({...s,recursive:!!s.recursive})); }
  source(id,userId) { return this.sources(userId).find(s=>s.id===id); }
  addSource({name,path:root,recursive=true,ownerId=null}) {
    const id=randomUUID();
    this.db.prepare('INSERT INTO sources(id,name,path,recursive,ownerId) VALUES (?,?,?,?,?)').run(id,name,path.resolve(root),recursive?1:0,ownerId);
    return this.source(id);
  }
  updateSource(id,patch) {
    const old=this.source(id); if(!old) return null;
    this.db.prepare('UPDATE sources SET name=?,path=?,recursive=? WHERE id=?').run(patch.name??old.name,path.resolve(patch.path??old.path),(patch.recursive??old.recursive)?1:0,id);
    return this.source(id);
  }
  sourceStatus(id,status,error=null) { this.db.prepare('UPDATE sources SET status=?,lastScan=?,error=? WHERE id=?').run(status,new Date().toISOString(),error,id); }
  removeSource(id) { const owner=this.source(id)?.ownerId;this.db.prepare('DELETE FROM sources WHERE id=?').run(id);this.bumpVersion(owner); }
  metadata(sourceId,relative,signature) {
    const row=this.db.prepare('SELECT payload FROM metadata WHERE sourceId=? AND relative=? AND signature=?').get(sourceId,relative,signature);
    return row?JSON.parse(row.payload):null;
  }
  libraryVersion(userId){return this.setting(userId===undefined?'libraryVersion':`libraryVersion:${userId}`)||0;}
  bumpVersion(userId){this.setSetting('libraryVersion',this.libraryVersion()+1);if(userId)this.setSetting(`libraryVersion:${userId}`,this.libraryVersion(userId)+1);}
  saveMetadata(sourceId,file) { this.db.prepare('INSERT OR REPLACE INTO metadata VALUES (?,?,?,?)').run(sourceId,file.relative,file.signature,JSON.stringify(file)); }
  trashedFiles(sourceId){
    const source=this.source(sourceId),files=new Set();if(!source)return files;
    for(const row of this.db.prepare('SELECT sourceId,payload FROM photo_trash WHERE ownerId=?').all(source.ownerId)){
      const data=JSON.parse(row.payload),root=this.source(row.sourceId,source.ownerId)?.path||data.asset.sourcePath;
      for(const file of data.files){const relative=path.relative(source.path,path.resolve(root,file.relative));if(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative))files.add(relative.split(path.sep).join('/'));}
    }
    return files;
  }
  saveAssets(sourceId,assets,complete) {
    this.db.exec('BEGIN');
    try {
      const upsert=this.db.prepare(`INSERT INTO assets(id,sourceId,relative,folder,filename,kind,takenAt,payload) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET relative=excluded.relative,folder=excluded.folder,filename=excluded.filename,kind=excluded.kind,takenAt=excluded.takenAt,payload=excluded.payload`);
      const ids=new Set();let changed=false;
      for(const a of assets){
        ids.add(a.id);const old=this.db.prepare('SELECT payload FROM assets WHERE id=?').get(a.id);
        // An incomplete traversal cannot safely replace an existing media relationship.
        if(!complete && old)continue;
        const payload=JSON.stringify(a);if(old?.payload!==payload)changed=true;
        upsert.run(a.id,sourceId,a.relative,a.folder,a.filename,a.kind,a.takenAt,payload);
      }
      if(complete){
        for(const row of this.db.prepare('SELECT id FROM assets WHERE sourceId=?').all(sourceId)) if(!ids.has(row.id)){this.db.prepare('DELETE FROM assets WHERE id=?').run(row.id);changed=true;}
      }
      if(changed)this.bumpVersion(this.source(sourceId)?.ownerId);
      this.db.exec('COMMIT');
    } catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  asset(id,userId) {
    const row=this.db.prepare(`SELECT a.*,s.path sourcePath,s.status sourceStatus,s.name sourceName FROM assets a JOIN sources s ON s.id=a.sourceId WHERE a.id=? ${userId===undefined?'':'AND s.ownerId=?'}`).get(id,...(userId===undefined?[]:[userId]));
    return row?{...JSON.parse(row.payload),favorite:userId===undefined?!!row.favorite:this.isFavorite(id,userId),sourcePath:row.sourcePath,sourceStatus:row.sourceStatus,sourceName:row.sourceName}:null;
  }
  photoIds({userId,source='',folder,search='',kind='',favorite=false,from,until}){
    const where=['s.ownerId=?'],args=[userId];
    if(source){where.push('a.sourceId=?');args.push(source);}if(folder!==undefined){where.push('a.folder=?');args.push(folder);}
    if(search){where.push("(a.filename LIKE ? ESCAPE '\\' OR a.folder LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");const q=`%${escapeLike(search)}%`;args.push(q,q,q);}
    if(['photo','live','video'].includes(kind)){where.push('a.kind=?');args.push(kind);}if(favorite){where.push('EXISTS(SELECT 1 FROM user_favorites f WHERE f.assetId=a.id AND f.userId=?)');args.push(userId);}
    if(from){where.push('a.takenAt>=?');args.push(from);}if(until){where.push('a.takenAt<?');args.push(until);}
    return this.db.prepare(`SELECT a.id FROM assets a JOIN sources s ON s.id=a.sourceId WHERE ${where.join(' AND ')} ORDER BY a.takenAt DESC,a.id`).all(...args).map(row=>row.id);
  }
  photos({userId,source='',folder,search='',kind='',favorite=false,offset=0,limit=100}={}) {
    const where=[],args=[];
    if(userId!==undefined){where.push('s.ownerId=?');args.push(userId);}
    if(source){where.push('a.sourceId=?');args.push(source);}
    if(folder!==undefined){where.push('a.folder=?');args.push(folder);}
    if(search){where.push("(a.filename LIKE ? ESCAPE '\\' OR a.folder LIKE ? ESCAPE '\\' OR s.name LIKE ? ESCAPE '\\')");const q=`%${escapeLike(search)}%`;args.push(q,q,q);}
    if(kind && ['photo','live','video'].includes(kind)){where.push('a.kind=?');args.push(kind);}
    if(favorite){if(userId===undefined)where.push('a.favorite=1');else{where.push('EXISTS(SELECT 1 FROM user_favorites f WHERE f.assetId=a.id AND f.userId=?)');args.push(userId);}}
    const clause=where.length?`WHERE ${where.join(' AND ')}`:'';
    const join='FROM assets a JOIN sources s ON a.sourceId=s.id';
    const total=this.db.prepare(`SELECT COUNT(*) total ${join} ${clause}`).get(...args).total;
    const rows=this.db.prepare(`SELECT a.*,s.name sourceName,s.status sourceStatus ${join} ${clause} ORDER BY a.takenAt DESC,a.id LIMIT ? OFFSET ?`).all(...args,limit,offset);
    return {total,items:rows.map(row=>{
      const a=JSON.parse(row.payload);
      return {id:a.id,sourceId:a.sourceId,sourceName:row.sourceName,folder:a.folder,filename:a.filename,kind:a.kind,takenAt:a.takenAt,width:a.width,height:a.height,duration:a.duration,favorite:userId===undefined?!!row.favorite:this.isFavorite(a.id,userId),available:row.sourceStatus!=='offline',version:a.version};
    })};
  }
  folders(userId) { return this.db.prepare(`SELECT a.sourceId,a.folder,s.name sourceName,COUNT(*) count,MAX(a.takenAt) latest FROM assets a JOIN sources s ON a.sourceId=s.id ${userId===undefined?'':'WHERE s.ownerId=?'} GROUP BY a.sourceId,a.folder ORDER BY latest DESC`).all(...(userId===undefined?[]:[userId])).map(row=>({...row,cover:this.db.prepare('SELECT id FROM assets WHERE sourceId=? AND folder=? ORDER BY takenAt DESC LIMIT 1').get(row.sourceId,row.folder)?.id})); }
  stats(userId) { return this.db.prepare(`SELECT COUNT(*) total,COALESCE(SUM(kind='live'),0) live,COALESCE(SUM(kind='video'),0) videos,COALESCE(SUM(${userId===undefined?'favorite':'EXISTS(SELECT 1 FROM user_favorites f WHERE f.assetId=a.id AND f.userId=?)'}),0) favorites,MIN(takenAt) firstDate,MAX(takenAt) lastDate FROM assets a JOIN sources s ON s.id=a.sourceId ${userId===undefined?'':'WHERE s.ownerId=?'}`).get(...(userId===undefined?[]:[userId,userId])); }
  isFavorite(id,userId){return !!this.db.prepare('SELECT 1 FROM user_favorites WHERE userId=? AND assetId=?').get(userId,id);}
  setFavorite(id,value,userId) { if(userId===undefined){this.db.prepare('UPDATE assets SET favorite=? WHERE id=?').run(value?1:0,id);return;}if(!this.asset(id,userId))return;if(value)this.db.prepare('INSERT OR IGNORE INTO user_favorites VALUES (?,?)').run(userId,id);else this.db.prepare('DELETE FROM user_favorites WHERE userId=? AND assetId=?').run(userId,id); }
  close(){this.db.close();}
}

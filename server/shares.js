import { randomUUID,randomBytes,createHash,timingSafeEqual,createCipheriv,createDecipheriv } from 'node:crypto';
import { readFileSync,writeFileSync } from 'node:fs';
import path from 'node:path';
import { userError } from './users.js';

const hash=token=>createHash('sha256').update(token).digest('hex');
const validId=id=>typeof id==='string'&&/^[a-f0-9-]{36}$/.test(id);
export class Shares {
  constructor(store){
    this.store=store;this.db=store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY,ownerId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,tokenHash TEXT NOT NULL,encryptedToken TEXT NOT NULL,expiresAt INTEGER,allowDownload INTEGER NOT NULL DEFAULT 0,revokedAt INTEGER,createdAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS share_items(shareId TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,assetId TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,position INTEGER NOT NULL,PRIMARY KEY(shareId,assetId));CREATE INDEX IF NOT EXISTS shares_owner ON shares(ownerId);`);
    const file=path.join(store.dataDir,'share.key');
    try{this.key=readFileSync(file);}catch(error){if(error.code!=='ENOENT')throw error;try{writeFileSync(file,randomBytes(32),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}this.key=readFileSync(file);}
    if(this.key.length!==32)throw new Error('分享加密密钥损坏，请恢复 .data/share.key');
  }
  encrypt(token,id,ownerId){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,iv);cipher.setAAD(Buffer.from(id+':'+ownerId));const data=Buffer.concat([cipher.update(token,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');}
  decrypt(row){try{const data=Buffer.from(row.encryptedToken,'base64'),cipher=createDecipheriv('aes-256-gcm',this.key,data.subarray(0,12));cipher.setAAD(Buffer.from(row.id+':'+row.ownerId));cipher.setAuthTag(data.subarray(12,28));return Buffer.concat([cipher.update(data.subarray(28)),cipher.final()]).toString('utf8');}catch{throw userError(409,'分享密钥无法读取，请重新生成链接');}}
  get(id,ownerId){const row=validId(id)&&this.db.prepare('SELECT * FROM shares WHERE id=?').get(id);if(!row||(ownerId!==undefined&&row.ownerId!==ownerId))throw userError(404,'分享不存在');return row;}
  metadata(row){const assets=this.db.prepare('SELECT i.assetId FROM share_items i JOIN assets a ON a.id=i.assetId JOIN sources s ON s.id=a.sourceId WHERE i.shareId=? AND s.ownerId=? ORDER BY i.position').all(row.id,row.ownerId);return {id:row.id,count:assets.length,cover:assets[0]?.assetId??null,expiresAt:row.expiresAt?new Date(row.expiresAt).toISOString():null,allowDownload:!!row.allowDownload,createdAt:new Date(row.createdAt).toISOString(),status:row.revokedAt?'revoked':row.expiresAt&&row.expiresAt<=Date.now()?'expired':'active'};}
  link(row){return `/s/${row.id}#${this.decrypt(row)}`;}
  settings(input,old={expiresAt:null,allowDownload:0},initial=false){
    if(!input||typeof input!=='object'||Array.isArray(input))throw userError(400,'分享设置不正确');
    const days=input.expiresInDays??(initial?7:undefined);
    if(input.expiresInDays===null||days!==undefined&&![0,1,7,30].includes(days))throw userError(400,'请选择正确的有效期');
    if(input.allowDownload!==undefined&&typeof input.allowDownload!=='boolean')throw userError(400,'下载设置不正确');
    return {expiresAt:days===undefined?old.expiresAt:days?Date.now()+days*86400_000:null,allowDownload:input.allowDownload===undefined?old.allowDownload:input.allowDownload?1:0};
  }
  create(ownerId,input){
    if(!Array.isArray(input?.ids)||!input.ids.length||input.ids.length>50000||input.ids.some(id=>typeof id!=='string'||!/^[a-f0-9]{24}$/.test(id)))throw userError(400,'请选择有效的照片（每次最多 50,000 项）');
    const ids=[...new Set(input.ids)];for(const id of ids)if(!this.store.asset(id,ownerId))throw userError(404,'有照片不存在或不属于你的相册，请重新选择');
    const options=this.settings(input,undefined,true),id=randomUUID(),token=randomBytes(32).toString('base64url');
    this.db.exec('BEGIN');try{
      this.db.prepare('INSERT INTO shares(id,ownerId,tokenHash,encryptedToken,expiresAt,allowDownload,createdAt) VALUES (?,?,?,?,?,?,?)').run(id,ownerId,hash(token),this.encrypt(token,id,ownerId),options.expiresAt,options.allowDownload,Date.now());
      const insert=this.db.prepare('INSERT INTO share_items VALUES (?,?,?)');ids.forEach((assetId,position)=>insert.run(id,assetId,position));this.db.exec('COMMIT');
    }catch(error){this.db.exec('ROLLBACK');throw error;}
    const row=this.get(id,ownerId);return {...this.metadata(row),link:this.link(row)};
  }
  list(ownerId){return this.db.prepare('SELECT * FROM shares WHERE ownerId=? ORDER BY createdAt DESC,id').all(ownerId).map(row=>this.metadata(row));}
  update(id,ownerId,input){const row=this.get(id,ownerId);if(row.revokedAt)throw userError(410,'分享已取消，请创建新的分享');const settings=this.settings(input,row);this.db.prepare('UPDATE shares SET expiresAt=?,allowDownload=? WHERE id=?').run(settings.expiresAt,settings.allowDownload,id);return this.metadata(this.get(id,ownerId));}
  rotate(id,ownerId){const row=this.get(id,ownerId);if(row.revokedAt)throw userError(410,'分享已取消');const token=randomBytes(32).toString('base64url');this.db.prepare('UPDATE shares SET tokenHash=?,encryptedToken=? WHERE id=?').run(hash(token),this.encrypt(token,id,ownerId),id);const next=this.get(id,ownerId);return {...this.metadata(next),link:this.link(next)};}
  revoke(id,ownerId){this.get(id,ownerId);this.db.prepare('UPDATE shares SET revokedAt=? WHERE id=?').run(Date.now(),id);}
  authorize(id,token){
    if(typeof token!=='string'||!/^[a-zA-Z0-9_-]{43}$/.test(token))throw userError(401,'请通过完整的分享链接访问');
    const row=this.get(id),actual=Buffer.from(hash(token),'hex'),expected=Buffer.from(row.tokenHash,'hex');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw userError(404,'分享链接无效');
    if(row.revokedAt||row.expiresAt&&row.expiresAt<=Date.now()||!this.store.users.get(row.ownerId)?.active)throw userError(410,'分享已到期或已取消');
    return row;
  }
  asset(row,id,variant){const item=this.db.prepare('SELECT 1 FROM share_items WHERE shareId=? AND assetId=?').get(row.id,id),asset=item&&this.store.asset(id,row.ownerId);if(!asset)throw userError(404,'这张照片不在分享中');if(['original','motion-original','download'].includes(variant)&&!row.allowDownload)throw userError(403,'分享者未开启原文件下载');return asset;}
  page(row,offset=0,limit=90){
    const assets=this.db.prepare('SELECT a.payload,s.status FROM share_items i JOIN assets a ON a.id=i.assetId JOIN sources s ON s.id=a.sourceId WHERE i.shareId=? AND s.ownerId=? ORDER BY i.position LIMIT ? OFFSET ?').all(row.id,row.ownerId,limit,offset);
    const items=assets.map(entry=>{const a=JSON.parse(entry.payload);return {id:a.id,sourceId:'',sourceName:'分享相册',folder:'',filename:a.filename,kind:a.kind,takenAt:a.takenAt,width:a.width,height:a.height,duration:a.duration,favorite:false,available:entry.status!=='offline',version:a.version};});
    const content=this.db.prepare("SELECT a.id,json_extract(a.payload,'$.version') version,CASE WHEN s.status='offline' THEN 0 ELSE 1 END available FROM share_items i JOIN assets a ON a.id=i.assetId JOIN sources s ON s.id=a.sourceId WHERE i.shareId=? AND s.ownerId=? ORDER BY i.position").all(row.id,row.ownerId);
    const revision=createHash('sha256').update(JSON.stringify([row.allowDownload,row.expiresAt,content])).digest('hex');
    return {id:row.id,allowDownload:!!row.allowDownload,expiresAt:row.expiresAt?new Date(row.expiresAt).toISOString():null,total:content.length,revision,items};
  }
}

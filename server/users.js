import { randomUUID, randomBytes, scrypt as callback } from 'node:crypto';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { assertOutsidePhotosLibrary } from './paths.js';

const scrypt=promisify(callback);
export const userError=(status,message)=>Object.assign(new Error(message),{status});
const key=p=>process.platform==='win32'?path.resolve(p).toLowerCase():path.resolve(p);
export const within=(root,target)=>{const relative=path.relative(key(root),key(target));return !relative || (!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative));};
const overlap=(a,b)=>within(a,b)||within(b,a);
export async function passwordHash(password){
  if(typeof password!=='string'||password.length<8||password.length>128)throw userError(400,'密码需为 8 至 128 个字符');
  const salt=randomBytes(16).toString('hex');return {salt,hash:(await scrypt(password,salt,64)).toString('hex')};
}
export class Users {
  constructor(store){
    this.store=store;this.db=store.db;
    this.db.exec(`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL UNIQUE COLLATE NOCASE,displayName TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('admin','member')),active INTEGER NOT NULL DEFAULT 1,salt TEXT NOT NULL,hash TEXT NOT NULL,allowedRoots TEXT NOT NULL DEFAULT '[]',credentialVersion INTEGER NOT NULL DEFAULT 0,createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS user_favorites(userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,assetId TEXT NOT NULL REFERENCES assets(id) ON DELETE CASCADE,PRIMARY KEY(userId,assetId));`);
    for(const [table,column,definition] of [['sources','ownerId','TEXT REFERENCES users(id)'],['sessions','userId','TEXT REFERENCES users(id)'],['sessions','version','INTEGER NOT NULL DEFAULT 0']]){
      if(!this.db.prepare(`PRAGMA table_info(${table})`).all().some(c=>c.name===column))this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
    this.db.exec('CREATE INDEX IF NOT EXISTS sources_owner ON sources(ownerId)');
    const legacy=store.setting('account');
    if(legacy&&!this.count()){
      const id=randomUUID();this.db.exec('BEGIN');try{
        this.db.prepare('INSERT INTO users(id,username,displayName,role,salt,hash,createdAt) VALUES (?,?,?,?,?,?,?)').run(id,'admin','相册主人','admin',legacy.salt,legacy.hash,new Date().toISOString());
        this.bindLegacy(id);store.setSetting('account',null);store.setSetting('setupToken',null);this.db.exec('COMMIT');
      }catch(e){this.db.exec('ROLLBACK');throw e;}
    }
  }
  count(){return this.db.prepare('SELECT COUNT(*) n FROM users').get().n;}
  get(id){const u=this.db.prepare('SELECT * FROM users WHERE id=?').get(id);return u?{...u,active:!!u.active,allowedRoots:JSON.parse(u.allowedRoots)}:null;}
  find(username){if(typeof username!=='string')return null;const row=this.db.prepare('SELECT id FROM users WHERE username=? COLLATE NOCASE').get(username.trim());return row?this.get(row.id):null;}
  public(u){if(!u)return null;const {id,username,displayName,role,active,allowedRoots,createdAt}=u;return {id,username,displayName,role,active,allowedRoots,createdAt};}
  list(){return this.db.prepare('SELECT id FROM users ORDER BY createdAt,id').all().map(u=>this.public(this.get(u.id)));}
  requireAdmin(id){const u=this.get(id);if(!u?.active||u.role!=='admin')throw userError(403,'仅管理员可以管理账号');return u;}
  identity(input){
    const username=typeof input.username==='string'?input.username.trim().toLowerCase():'';
    if(!/^[a-z0-9][a-z0-9_.-]{2,31}$/.test(username))throw userError(400,'用户名需为 3 至 32 位字母、数字、点、下划线或短横线');
    return {username,displayName:this.displayName(input.displayName??username)};
  }
  displayName(value){if(typeof value!=='string'||!value.trim()||value.trim().length>40)throw userError(400,'显示名称需为 1 至 40 个字符');return value.trim();}
  bindLegacy(id){
    this.db.prepare('UPDATE sources SET ownerId=? WHERE ownerId IS NULL').run(id);
    this.db.prepare('INSERT OR IGNORE INTO user_favorites(userId,assetId) SELECT ?,a.id FROM assets a JOIN sources s ON s.id=a.sourceId WHERE a.favorite=1 AND s.ownerId=?').run(id,id);
    this.db.exec('UPDATE assets SET favorite=0');this.db.prepare('UPDATE sessions SET userId=? WHERE userId IS NULL').run(id);
  }
  assertNoOverlap(roots,ignoreId){
    for(const other of this.list())if(other.id!==ignoreId){
      const reserved=[...other.allowedRoots,...this.store.sources(other.id).map(s=>s.path)];
      if(roots.some(root=>reserved.some(r=>overlap(root,r))))throw userError(403,'这个目录与其他账号的照片空间重叠，请选择独立文件夹');
    }
  }
  async roots(input,ignoreId){
    if(!Array.isArray(input)||input.length>16||input.some(p=>typeof p!=='string'||!path.isAbsolute(p)))throw userError(400,'请填写最多 16 个完整文件夹路径');
    const roots=[];
    for(const p of input){assertOutsidePhotosLibrary(p);let full;try{full=await realpath(p);if(!(await stat(full)).isDirectory())throw new Error();}catch{throw userError(400,'授权目录不存在，请确认硬盘已连接');}
      assertOutsidePhotosLibrary(full);
      const data=await realpath(this.store.dataDir);if(overlap(full,data))throw userError(400,'授权目录不能包含相册数据或缓存');
      if(!roots.some(r=>key(r)===key(full)))roots.push(full);
    }
    this.assertNoOverlap(roots,ignoreId);return roots;
  }
  async assertSource(userId,input){
    assertOutsidePhotosLibrary(input);
    if(path.resolve(input).split(/[\\/]/).some(part=>part.toLowerCase()==='.keeplive-trash'))throw userError(400,'回收目录不能作为照片来源');
    let full;try{full=await realpath(input);if(!(await stat(full)).isDirectory())throw new Error();}catch{throw userError(400,'找不到这个文件夹，请确认路径及硬盘连接');}
    assertOutsidePhotosLibrary(full);
    if(full.split(/[\\/]/).some(part=>part.toLowerCase()==='.keeplive-trash'))throw userError(400,'回收目录不能作为照片来源');
    const data=await realpath(this.store.dataDir);
    const user=this.get(userId);if(!user?.active)throw userError(401,'请重新登录');
    this.assertNoOverlap([full],userId);
    if(user.role!=='admin'){
      const allowed=[];for(const root of user.allowedRoots){try{const physical=await realpath(root);if(path.relative(root,physical)==='')allowed.push(physical);}catch{}}
      if(!allowed.some(root=>within(root,full)))throw userError(403,'请在管理员为你分配的照片目录内添加文件夹');
    }
    if(overlap(full,data))throw userError(400,'照片目录不能包含相册数据和缓存目录');
    return full;
  }
  async create(input,actorId=null,{initial=false,authorize=()=>{}}={}){
    const actor=initial?null:this.requireAdmin(actorId);
    if(initial&&this.count())throw userError(409,'相册已经初始化');
    const identity=this.identity(input),role=initial?'admin':input.role??'member';
    if(!['admin','member'].includes(role))throw userError(400,'账号角色不正确');
    if(this.find(identity.username))throw userError(409,'这个用户名已经使用');
    const roots=await this.roots(initial?[]:input.allowedRoots??[],null),credentials=await passwordHash(input.password);
    if(initial){if(this.count())throw userError(409,'相册已经初始化');}else if(this.requireAdmin(actorId).credentialVersion!==actor.credentialVersion)throw userError(401,'账号状态已变化，请重新登录');
    authorize();
    if(this.find(identity.username))throw userError(409,'这个用户名已经使用');this.assertNoOverlap(roots,null);
    const id=randomUUID();this.db.exec('BEGIN');try{
      this.db.prepare('INSERT INTO users(id,username,displayName,role,salt,hash,allowedRoots,createdAt) VALUES (?,?,?,?,?,?,?,?)').run(id,identity.username,identity.displayName,role,credentials.salt,credentials.hash,JSON.stringify(roots),new Date().toISOString());
      if(initial){this.bindLegacy(id);this.store.setSetting('setupToken',null);}this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}return this.get(id);
  }
  profile(id,displayName){this.db.prepare('UPDATE users SET displayName=? WHERE id=?').run(this.displayName(displayName),id);return this.get(id);}
  async update(id,input,actorId,authorize=()=>{}){
    const actor=this.requireAdmin(actorId);let old=this.get(id);if(!old)throw userError(404,'账号不存在');
    const roots=input.allowedRoots===undefined?old.allowedRoots:await this.roots(input.allowedRoots,id);
    if(this.requireAdmin(actorId).credentialVersion!==actor.credentialVersion)throw userError(401,'账号状态已变化，请重新登录');old=this.get(id);
    authorize();
    const role=input.role??old.role,active=input.active??old.active,name=input.displayName===undefined?old.displayName:this.displayName(input.displayName);
    if(!['admin','member'].includes(role)||typeof active!=='boolean')throw userError(400,'账号设置不正确');
    if(old.role==='admin'&&old.active&&(!active||role!=='admin')&&this.db.prepare("SELECT COUNT(*) n FROM users WHERE role='admin' AND active=1").get().n<=1)throw userError(409,'至少需要保留一个可用的管理员账号');
    this.assertNoOverlap(roots,id);
    if(role==='member'&&this.store.sources(id).some(s=>!roots.some(r=>within(r,s.path))))throw userError(409,'现有照片目录不在新的授权范围内，请先移除或重新定位目录');
    const changed=role!==old.role||active!==old.active||JSON.stringify(roots)!==JSON.stringify(old.allowedRoots);
    this.db.prepare('UPDATE users SET displayName=?,role=?,active=?,allowedRoots=?,credentialVersion=credentialVersion+? WHERE id=?').run(name,role,active?1:0,JSON.stringify(roots),changed?1:0,id);
    if(changed)this.revoke(id);return this.get(id);
  }
  revoke(id){this.db.prepare('DELETE FROM sessions WHERE userId=?').run(id);}
  setPassword(id,credentials,expectedVersion){const old=this.get(id);if(!old?.active||old.credentialVersion!==expectedVersion)throw userError(401,'账号状态已变化，请重新登录');
    this.db.prepare('UPDATE users SET salt=?,hash=?,credentialVersion=credentialVersion+1 WHERE id=?').run(credentials.salt,credentials.hash,id);this.revoke(id);return this.get(id);
  }
}


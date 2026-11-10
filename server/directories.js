import path from 'node:path';
import { realpath,readdir,stat } from 'node:fs/promises';
import { within,userError } from './users.js';
import { isPhotosLibraryPath,isForeignWindowsPath } from './paths.js';

export const directoryName=full=>path.basename(full)||path.parse(full).root;

export async function browseDirectories(store,userId,input){
  const user=store.users.get(userId);
  if(!user?.active)throw userError(401,'请重新登录');
  const allowed=[];
  for(const root of user.allowedRoots){try{const actual=await realpath(root);if(path.relative(root,actual)==='')allowed.push(actual);}catch{}}
  const data=await realpath(store.dataDir);
  const reserved=store.users.list().filter(u=>u.id!==userId).flatMap(u=>[...u.allowedRoots,...store.sources(u.id).map(s=>s.path)]);
  const permitted=full=>!isPhotosLibraryPath(full)&&!within(data,full)&&!reserved.some(root=>within(root,full))&&(user.role==='admin'||allowed.some(root=>within(root,full)));
  const resolve=async full=>{
    const actual=await realpath(full);
    if(!permitted(actual))throw userError(403,'这个文件夹不在你的可浏览范围内');
    if(!(await stat(actual)).isDirectory())throw userError(400,'请选择文件夹');
    return actual;
  };
  if(typeof input==='string'&&isForeignWindowsPath(input))input=undefined;
  if(input!==undefined&&(typeof input!=='string'||!path.isAbsolute(input)))throw userError(400,'文件夹路径不正确');
  if(!input){
    const candidates=user.role==='admin'?(process.platform==='win32'?Array.from({length:26},(_,i)=>`${String.fromCharCode(65+i)}:\\`):['/']):allowed;
    const directories=[];
    for(const candidate of candidates){try{const full=await resolve(candidate);directories.push({name:directoryName(full),path:full});}catch{}}
    return {path:null,parent:null,selectable:false,directories};
  }
  const full=await resolve(input);
  const entries=await readdir(full,{withFileTypes:true}),directories=[];
  for(const entry of entries){
    if(!entry.isDirectory())continue;
    const child=path.join(full,entry.name);
    try{
      const actual=await resolve(child);
      // Never follow junctions or links into a different location while browsing.
      if(path.relative(child,actual)!=='')continue;
      directories.push({name:entry.name,path:actual});
    }catch{}
  }
  directories.sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true}));
  const parent=path.dirname(full);
  let selectable=false;try{await store.users.assertSource(userId,full);selectable=true;}catch(error){if(error.status===401)throw error;}
  return {path:full,parent:parent!==full&&permitted(parent)?parent:null,selectable,directories};
}

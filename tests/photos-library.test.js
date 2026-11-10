import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,stat,access,realpath,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {createApp} from '../server/app.js';
import {walk} from '../server/library.js';

async function fixture(){
  const base=await mkdtemp(path.join(await realpath(tmpdir()),'keeplive-photos-package-'));
  const root=path.join(base,'pictures'),bundle=path.join(root,'Family.PHOTOSLIBRARY'),original=path.join(bundle,'originals','photo.jpg');
  await mkdir(path.dirname(original),{recursive:true});
  await mkdir(path.join(bundle,'resources'),{recursive:true});
  await writeFile(original,'synthetic original');
  await writeFile(path.join(bundle,'resources','thumbnail.jpg'),'synthetic derivative');
  await writeFile(path.join(root,'normal.jpg'),'synthetic normal photo');
  const alias=path.join(root,'shortcut');await symlink(bundle,alias,process.platform==='win32'?'junction':'dir');
  return {base,root,bundle,original,alias,async close(){await rm(base,{recursive:true,force:true});}};
}

test('recursive scans skip Photos packages and refuse to scan a package root',async()=>{
  const f=await fixture();
  try{
    assert.deepEqual((await walk(f.root,true)).files.map(file=>file.relative),['normal.jpg']);
    const direct=await walk(f.bundle,true);assert.equal(direct.files.length,0);assert.ok(direct.errors.length);
    assert.equal((await walk(path.join(f.bundle,'originals'),true)).files.length,0);
    assert.equal((await walk(f.alias,true)).files.length,0);
  }finally{await f.close();}
});

test('source creation, grants and folder browsing reject Photos packages, descendants and aliases',async()=>{
  const f=await fixture(),runtime=createApp({dataDir:path.join(f.base,'data')});
  const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;let cookie='';
  const request=(route,method='GET',body)=>fetch(origin+'/api'+route,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
  try{
    const setup=await request('/auth/setup','POST',{username:'owner',password:'package-test-password'});
    cookie=setup.headers.get('set-cookie').split(';')[0];
    for(const folder of [f.bundle,path.join(f.bundle,'originals'),f.alias,path.join(f.alias,'originals')]){
      const added=await request('/sources','POST',{path:folder,recursive:true});assert.equal(added.status,400,folder);assert.match((await added.json()).error,/图库/);
      assert.equal((await request('/directories?path='+encodeURIComponent(folder))).status,403);
    }
    const grant=await request('/users','POST',{username:'member',password:'package-test-password',allowedRoots:[f.bundle]});
    assert.equal(grant.status,400);assert.equal(runtime.store.users.count(),1);
    const listing=await(await request('/directories?path='+encodeURIComponent(f.root))).json();
    assert.equal(listing.selectable,true);assert.deepEqual(listing.directories,[]);
    assert.equal(runtime.store.sources().length,0);
  }finally{await new Promise(resolve=>server.close(resolve));await runtime.close();await f.close();}
});

test('previously indexed Photos originals cannot be downloaded or moved, including through links',async()=>{
  const f=await fixture(),runtime=createApp({dataDir:path.join(f.base,'data')});
  try{
    const owner=await runtime.store.users.create({username:'owner',password:'package-test-password'},null,{initial:true});
    const source=runtime.store.addSource({name:'Existing parent',path:f.root,ownerId:owner.id});
    const info=await stat(f.original),bytes=await readFile(f.original);
    const assets=['Family.PHOTOSLIBRARY/originals/photo.jpg','shortcut/originals/photo.jpg'].map((relative,index)=>({
      id:(index?'b':'a').repeat(24),sourceId:source.id,relative,folder:path.posix.dirname(relative),filename:'photo.jpg',kind:'photo',takenAt:'2026-01-01T00:00:00.000Z',signature:`${info.size}:${info.mtimeMs}`,version:'fixture',width:1,height:1
    }));
    runtime.store.saveAssets(source.id,assets,true);
    for(const asset of assets){
      await assert.rejects(runtime.media.get(asset.id,'original'),error=>error.status===400&&/图库/.test(error.message));
      const result=await runtime.trash.move(owner.id,[asset.id],()=>{});
      assert.deepEqual(result.moved,[]);assert.equal(result.failures.length,1);assert.match(result.failures[0].error,/图库/);
    }
    assert.deepEqual(await readFile(f.original),bytes);
    await assert.rejects(access(path.join(f.root,'.keeplive-trash')));
    const legacy=runtime.store.addSource({name:'Legacy package',path:f.bundle,ownerId:owner.id});
    runtime.store.saveAssets(legacy.id,[{...assets[0],id:'c'.repeat(24),sourceId:legacy.id,relative:'originals/photo.jpg'}],true);
    await runtime.library.run([legacy]);
    assert.equal(runtime.store.source(legacy.id).status,'offline');
    assert.equal(runtime.store.photos({source:legacy.id}).total,1,'Old package indexes remain available for relocation without moving originals');
  }finally{await runtime.close();await f.close();}
});

test('canonical source equality respects case-sensitive POSIX paths',async()=>{
  const {samePath}=await import('../server/paths.js');
  assert.equal(samePath(path.resolve('PhotoCase'),path.resolve('PhotoCase','.')),true);
  assert.equal(samePath(path.resolve('PhotoCase'),path.resolve('photocase')),process.platform==='win32');
  assert.equal(samePath(path.resolve('PhotoCase'),path.resolve('PhotoCase-Other')),false);
});

test('a legacy trash record cannot restore a missing original into a Photos package',async()=>{
  const f=await fixture(),runtime=createApp({dataDir:path.join(f.base,'data')});
  try{
    const owner=await runtime.store.users.create({username:'owner',password:'package-test-password'},null,{initial:true});
    const source=runtime.store.addSource({name:'Parent',path:f.root,ownerId:owner.id});
    const info=await stat(path.join(f.root,'normal.jpg'));
    const asset={id:'d'.repeat(24),sourceId:source.id,relative:'normal.jpg',folder:'',filename:'normal.jpg',kind:'photo',takenAt:'2026-01-01T00:00:00.000Z',signature:`${info.size}:${info.mtimeMs}`,version:'fixture',width:1,height:1};
    runtime.store.saveAssets(source.id,[asset],true);
    assert.deepEqual((await runtime.trash.move(owner.id,[asset.id],()=>{})).moved,[asset.id]);
    const row=runtime.store.db.prepare('SELECT * FROM photo_trash').get(),payload=JSON.parse(row.payload);
    const destination=path.join(f.bundle,'originals','restored.jpg');
    payload.files[0].relative='Family.PHOTOSLIBRARY/originals/restored.jpg';
    runtime.store.db.prepare('UPDATE photo_trash SET payload=? WHERE id=?').run(JSON.stringify(payload),row.id);
    const archived=path.join(f.root,payload.files[0].archived),bytes=await readFile(archived);
    await assert.rejects(runtime.trash.restore(owner.id,row.id,()=>{}),error=>error.status===400&&/图库/.test(error.message));
    await assert.rejects(access(destination));
    assert.deepEqual(await readFile(archived),bytes);
    assert.ok(runtime.store.db.prepare('SELECT id FROM photo_trash WHERE id=?').get(row.id),'Preserve recovery records when a protected destination is rejected');
  }finally{await runtime.close();await f.close();}
});

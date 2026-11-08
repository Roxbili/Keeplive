import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rename,rm,access,symlink,stat,utimes} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import sharp from 'sharp';
import ffmpeg from 'ffmpeg-static';
import {createApp} from '../server/app.js';

async function fixture(){
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-trash-')),root=path.join(base,'photos');await mkdir(root);
  for(const name of ['live.jpg','still.jpg'])await sharp({create:{width:64,height:48,channels:3,background:'#123456'}}).jpeg().toFile(path.join(root,name));
  const video=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x48:d=0.12','-c:v','libx264',path.join(root,'live.mov')]);assert.equal(video.status,0);
  const runtime=createApp({dataDir:path.join(base,'data')}),server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(url,cookie='',method='GET',body)=>fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const setup=await request('/auth/setup','','POST',{username:'owner',password:'trash-test-password'}),cookie=setup.headers.get('set-cookie').split(';')[0],owner=runtime.store.users.find('owner');
  const source=runtime.store.addSource({path:root,name:'Photos',ownerId:owner.id});await runtime.library.scan();
  const assets=runtime.store.photos({userId:owner.id}).items;
  return {base,root,runtime,source,owner,cookie,assets,request,async close(){await new Promise(r=>server.close(r));await runtime.close();await rm(base,{recursive:true,force:true});}};
}

test('live deletion moves both originals, removes shares and can restore original bytes and favorites',async()=>{
  const f=await fixture();try{
    const live=f.assets.find(a=>a.kind==='live'),image=await readFile(path.join(f.root,'live.jpg')),video=await readFile(path.join(f.root,'live.mov'));
    await f.request('/photos/'+live.id+'/favorite',f.cookie,'PATCH',{favorite:true});
    const share=f.runtime.shares.create(f.owner.id,{ids:[live.id]});
    const response=await f.request('/photos/trash',f.cookie,'POST',{ids:[live.id]});assert.equal(response.status,200);
    const result=await response.json();assert.deepEqual(result.moved,[live.id]);assert.deepEqual(result.failures,[]);
    await assert.rejects(access(path.join(f.root,'live.jpg')));await assert.rejects(access(path.join(f.root,'live.mov')));
    assert.equal((await f.request('/media/'+live.id+'/thumb',f.cookie)).status,404);
    assert.equal(f.runtime.shares.list(f.owner.id).find(s=>s.id===share.id).count,0);
    await f.runtime.library.scan();assert.equal(f.runtime.store.photos({userId:f.owner.id}).total,1);
    const list=await(await f.request('/trash',f.cookie)).json();assert.equal(list.items.length,1);assert.equal(JSON.stringify(list).includes(f.root),false);
    assert.equal((await f.request('/sources/'+f.source.id,f.cookie,'DELETE')).status,409,'keep source configuration needed for recovery');
    const aliasPath=path.join(f.base,'ordinary-folder');await symlink(path.join(f.root,'.keeplive-trash'),aliasPath,'junction');
    assert.equal((await f.request('/sources',f.cookie,'POST',{path:aliasPath})).status,400,'canonical trash paths cannot become a photo source');
    assert.equal((await f.request('/trash/'+list.items[0].id+'/restore',f.cookie,'POST',{})).status,200);
    assert.deepEqual(await readFile(path.join(f.root,'live.jpg')),image);assert.deepEqual(await readFile(path.join(f.root,'live.mov')),video);
    assert.equal(f.runtime.store.asset(live.id,f.owner.id).favorite,true);
    assert.equal(f.runtime.shares.list(f.owner.id).find(s=>s.id===share.id).count,0,'restore must not silently re-share');
    assert.equal((await(await f.request('/trash',f.cookie)).json()).items.length,0);
  }finally{await f.close();}
});

test('trash is account-confined, rejects foreign batches and stale files, and never overwrites a replacement on restore',async()=>{
  const f=await fixture();try{
    const memberRoot=path.join(f.base,'member');await mkdir(memberRoot);
    const member=await f.runtime.store.users.create({username:'member',password:'member-test-password',allowedRoots:[memberRoot]},f.owner.id);
    const login=await f.request('/auth/login','','POST',{username:'member',password:'member-test-password'}),memberCookie=login.headers.get('set-cookie').split(';')[0];
    const photo=f.assets.find(a=>a.kind==='photo');
    assert.equal((await f.request('/photos/trash','','POST',{ids:[photo.id]})).status,401);
    assert.equal((await f.request('/photos/trash',memberCookie,'POST',{ids:[photo.id]})).status,404);
    assert.equal((await f.request('/photos/trash',f.cookie,'POST',{ids:[photo.id,'0'.repeat(24)]})).status,404);await access(path.join(f.root,'still.jpg'));
    await sharp({create:{width:80,height:60,channels:3,background:'#aabbcc'}}).jpeg().toFile(path.join(f.root,'still.jpg'));
    const stale=await(await f.request('/photos/trash',f.cookie,'POST',{ids:[photo.id]})).json();assert.equal(stale.moved.length,0);assert.equal(stale.failures.length,1);await access(path.join(f.root,'still.jpg'));
    await f.runtime.library.scan();const deleted=await(await f.request('/photos/trash',f.cookie,'POST',{ids:[photo.id]})).json();assert.equal(deleted.moved.length,1);
    const item=(await(await f.request('/trash',f.cookie)).json()).items[0];
    assert.deepEqual((await(await f.request('/trash',memberCookie)).json()).items,[]);
    assert.equal((await f.request('/trash/'+item.id+'/restore',memberCookie,'POST',{})).status,404);
    await writeFile(path.join(f.root,'still.jpg'),'new file');
    assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,409);assert.equal(await readFile(path.join(f.root,'still.jpg'),'utf8'),'new file');
    assert.equal((await(await f.request('/trash',f.cookie)).json()).items.length,1);
    assert.equal((await f.request('/sources',f.cookie,'POST',{path:path.join(f.root,'.keeplive-trash'),recursive:true})).status,400);
  }finally{await f.close();}
});

test('an interrupted live move retains a recovery record, including across source relocation',async()=>{
  const f=await fixture();try{
    const live=f.assets.find(a=>a.kind==='live');const originalRename=f.runtime.trash.moveFile;let calls=0;
    f.runtime.trash.moveFile=async(...args)=>{if(++calls===2)throw new Error('simulated disk disconnect');return originalRename(...args);};
    const result=await(await f.request('/photos/trash',f.cookie,'POST',{ids:[live.id]})).json();assert.equal(result.failures.length,1);
    f.runtime.trash.moveFile=originalRename;
    const item=(await(await f.request('/trash',f.cookie)).json()).items[0];assert.ok(item);
    const relocated=path.join(f.base,'relocated');await rename(f.root,relocated);f.runtime.store.updateSource(f.source.id,{path:relocated});
    assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,200);
    await access(path.join(relocated,'live.jpg'));await access(path.join(relocated,'live.mov'));
    assert.equal(f.runtime.store.asset(live.id,f.owner.id).kind,'live');
  }finally{await f.close();}
});

test('restore resumes its own hard link and exclusive copy after cleanup or timestamp failure',async()=>{
  for(const copy of [false,true]){
    const f=await fixture();try{
      const photo=f.assets.find(a=>a.kind==='photo'),bytes=await readFile(path.join(f.root,'still.jpg'));
      await f.request('/photos/trash',f.cookie,'POST',{ids:[photo.id]});
      const item=(await(await f.request('/trash',f.cookie)).json()).items[0];
      const trash=f.runtime.trash,originalUnlink=trash.unlinkFile,originalTime=trash.utimesFile;
      if(copy){trash.linkFile=async()=>{throw Object.assign(new Error('unsupported'),{code:'ENOTSUP'});};trash.utimesFile=async()=>{throw new Error('disk disconnected');};}
      else trash.unlinkFile=async()=>{throw new Error('disk disconnected');};
      assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,500);
      trash.unlinkFile=originalUnlink;trash.utimesFile=originalTime;
      if(copy){await writeFile(path.join(f.root,'still.jpg'),'replacement');assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,409);assert.equal(await readFile(path.join(f.root,'still.jpg'),'utf8'),'replacement');await writeFile(path.join(f.root,'still.jpg'),bytes);}
      assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,200);
      assert.deepEqual(await readFile(path.join(f.root,'still.jpg')),bytes);
      assert.equal((await(await f.request('/trash',f.cookie)).json()).items.length,0);
    }finally{await f.close();}
  }
});

test('nested source aliases lose access and shares immediately, including interrupted live moves',async()=>{
  const f=await fixture();try{
    const nested=path.join(f.root,'nested');await mkdir(nested);
    for(const name of ['live.jpg','live.mov'])await rename(path.join(f.root,name),path.join(nested,name));
    const parent=f.runtime.store.addSource({path:nested,name:'Nested',ownerId:f.owner.id});await f.runtime.library.scan(f.owner.id);
    const live=f.runtime.store.photos({userId:f.owner.id,source:f.source.id}).items.find(a=>a.kind==='live'),alias=f.runtime.store.photos({userId:f.owner.id,source:parent.id}).items.find(a=>a.kind==='live');
    f.runtime.store.setFavorite(alias.id,true,f.owner.id);
    const share=f.runtime.shares.create(f.owner.id,{ids:[alias.id]});
    const originalMove=f.runtime.trash.moveFile;let calls=0;
    f.runtime.trash.moveFile=async(...args)=>{if(++calls===2)throw new Error('disconnect');return originalMove(...args);};
    const result=await(await f.request('/photos/trash',f.cookie,'POST',{ids:[live.id]})).json();assert.equal(result.failures.length,1);
    assert.equal(f.runtime.store.asset(alias.id,f.owner.id),null);
    assert.equal(f.runtime.shares.list(f.owner.id).find(s=>s.id===share.id).count,0);
    await f.runtime.library.scan(f.owner.id);
    assert.equal(f.runtime.store.photos({userId:f.owner.id,source:parent.id}).items.some(a=>a.filename.startsWith('live.')),false);
    const item=(await(await f.request('/trash',f.cookie)).json()).items[0];
    assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,200);
    assert.equal(f.runtime.store.asset(alias.id,f.owner.id).favorite,true);
    assert.equal(f.runtime.shares.list(f.owner.id).find(s=>s.id===share.id).count,0);
  }finally{await f.close();}
});

test('relocation to a same-signature copy cannot consume the real recovery record',async()=>{
  const f=await fixture();try{
    const photo=f.assets.find(a=>a.kind==='photo'),info=await stat(path.join(f.root,'still.jpg')),bytes=await readFile(path.join(f.root,'still.jpg'));
    await f.request('/photos/trash',f.cookie,'POST',{ids:[photo.id]});const item=(await(await f.request('/trash',f.cookie)).json()).items[0];
    const replacement=path.join(f.base,'new-root');await mkdir(replacement);await writeFile(path.join(replacement,'still.jpg'),bytes);await utimes(path.join(replacement,'still.jpg'),info.atime,info.mtime);
    f.runtime.store.updateSource(f.source.id,{path:replacement});
    assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,409);
    assert.equal((await(await f.request('/trash',f.cookie)).json()).items.length,1);
    f.runtime.store.updateSource(f.source.id,{path:f.root});
    assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,200);
    assert.deepEqual(await readFile(path.join(f.root,'still.jpg')),bytes);
  }finally{await f.close();}
});

test('live copy recovery resumes after the first part has already been completely restored',async()=>{
  const f=await fixture();try{
    const live=f.assets.find(a=>a.kind==='live');await f.request('/photos/trash',f.cookie,'POST',{ids:[live.id]});
    const item=(await(await f.request('/trash',f.cookie)).json()).items[0],trash=f.runtime.trash,cleanup=trash.unlinkFile;let calls=0;
    trash.linkFile=async()=>{throw Object.assign(new Error('unsupported'),{code:'ENOTSUP'});};
    trash.unlinkFile=async(...args)=>{if(++calls===2)throw new Error('disk disconnected');return cleanup(...args);};
    assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,500);
    trash.unlinkFile=cleanup;
    assert.equal((await f.request('/trash/'+item.id+'/restore',f.cookie,'POST',{})).status,200);
    assert.equal(f.runtime.store.asset(live.id,f.owner.id).kind,'live');
  }finally{await f.close();}
});

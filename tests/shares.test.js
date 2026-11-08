import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

async function fixture(){
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-shares-')),root=path.join(base,'photos');await mkdir(root);
  const sharp=(await import('sharp')).default;
  await sharp({create:{width:32,height:24,channels:3,background:'#667788'}}).jpeg().toFile(path.join(root,'a.jpg'));
  await sharp({create:{width:32,height:24,channels:3,background:'#abcdef'}}).jpeg().toFile(path.join(root,'b.jpg'));
  const runtime=createApp({dataDir:path.join(base,'data')}),server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(url,cookie='',method='GET',body)=>fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const setup=await request('/auth/setup','','POST',{username:'owner',password:'owner-password'}),cookie=setup.headers.get('set-cookie').split(';')[0],owner=runtime.store.users.find('owner');
  const source=runtime.store.addSource({name:'Private folder',path:root,ownerId:owner.id});await runtime.library.scan(owner.id);await runtime.media.warming;
  const ids=runtime.store.photos({userId:owner.id}).items.map(p=>p.id);
  const create=async(options={})=>{const response=await request('/shares',cookie,'POST',{ids:[ids[0]],...options});assert.equal(response.status,201,await response.clone().text());return response.json();};
  const enter=async share=>{const response=await request('/shared/'+share.id+'/access','','POST',{token:share.link.split('#')[1]});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];};
  return {base,root,runtime,server,origin,request,cookie,owner,source,ids,create,enter,async close(){await new Promise(r=>server.close(r));await runtime.close();await rm(base,{recursive:true,force:true});}};
}

test('anonymous share capability confines media, denies private APIs and original downloads by default',async()=>{
  const f=await fixture();try{
    const share=await f.create(),guest=await f.enter(share);
    const stored=f.runtime.store.db.prepare('SELECT * FROM shares WHERE id=?').get(share.id);
    assert.equal(JSON.stringify(stored).includes(share.link.split('#')[1]),false);assert.equal(stored.tokenHash.length,64);
    assert.deepEqual((await(await f.request('/photo-selection',f.cookie)).json()).ids,f.ids);
    assert.equal((await(await f.request('/photos?limit=1',f.cookie)).json()).items.length,1);
    const filtered=await(await f.request('/photo-selection?search=a.jpg',f.cookie)).json();assert.equal(filtered.ids.length,1);
    assert.deepEqual((await(await f.request('/photo-selection?from=2090-01-01T00:00:00.000Z',f.cookie)).json()).ids,[]);
    assert.equal((await f.request('/photo-selection?until=bad-date',f.cookie)).status,400);
    f.runtime.store.saveAssets(f.source.id,[{id:'c'.repeat(24),sourceId:f.source.id,relative:'movie.mov',filename:'movie.mov',folder:'',kind:'video',takenAt:new Date().toISOString(),version:'fixture'}],false);
    assert.deepEqual((await(await f.request('/photo-selection?kind=photo',f.cookie)).json()).ids,f.ids);
    assert.equal(share.allowDownload,false);assert.equal(share.count,1);assert.ok(Date.parse(share.expiresAt)>Date.now()+6*86400_000);
    assert.equal((await f.request('/shared/'+share.id)).status,401);
    const page=await f.request('/shared/'+share.id,guest);assert.equal(page.status,200);
    assert.match(page.headers.get('cache-control'),/no-store/);assert.equal(page.headers.get('referrer-policy'),'no-referrer');
    const text=await page.text();assert.equal(text.includes(f.root),false);assert.equal(text.includes('allowedRoots'),false);assert.equal(text.includes(share.link.split('#')[1]),false);
    assert.equal(JSON.parse(text).items.length,1);
    assert.equal((await f.request('/photos',guest)).status,401);assert.equal((await f.request('/shares',guest)).status,401);
    assert.equal((await f.request('/photos/'+f.ids[0],guest)).status,401);
    assert.equal((await f.request(`/shared/${share.id}/media/${f.ids[0]}/thumb`,guest)).status,200);
    assert.equal((await f.request(`/shared/${share.id}/media/${f.ids[1]}/thumb`,guest)).status,404);
    for(const variant of ['original','motion-original'])assert.equal((await f.request(`/shared/${share.id}/media/${f.ids[0]}/${variant}`,guest)).status,403);
    await f.request('/shares/'+share.id,f.cookie,'PATCH',{allowDownload:true});
    assert.equal((await f.request(`/shared/${share.id}/media/${f.ids[0]}/original`,guest)).status,200);
    const another=await f.create({ids:[f.ids[1]]});assert.equal((await f.request('/shared/'+another.id,guest)).status,401);
  }finally{await f.close();}
});
test('sharing is owner-only and rejects unknown assets; link regeneration and expiry revoke guests',async()=>{
  const f=await fixture();try{
    const created=await f.request('/users',f.cookie,'POST',{username:'member',password:'member-password'});assert.equal(created.status,201);
    const login=await f.request('/auth/login','','POST',{username:'member',password:'member-password'}),member=login.headers.get('set-cookie').split(';')[0];
    assert.equal((await f.request('/shares',member,'POST',{ids:f.ids})).status,404);
    assert.deepEqual((await(await f.request('/photo-selection',member)).json()).ids,[]);
    assert.equal((await f.request('/shares',f.cookie,'POST',{ids:[f.ids[0],'z'.repeat(24)]})).status,400);
    const share=await f.create(),guest=await f.enter(share);
    assert.equal((await f.request('/shares/'+share.id,member,'PATCH',{allowDownload:true})).status,404);
    assert.equal((await f.request('/shares',member)).status,200);assert.equal((await(await f.request('/shares',member)).json()).length,0);
    assert.equal((await f.request('/shares/'+share.id+'/link',f.cookie)).status,200);
    const rotated=await f.request('/shares/'+share.id+'/rotate',f.cookie,'POST',{});assert.equal(rotated.status,200);const next=await rotated.json();assert.notEqual(next.link,share.link);
    assert.equal((await f.request('/shared/'+share.id,guest)).status,404);
    const fresh=await f.enter(next);
    f.runtime.store.db.prepare('UPDATE shares SET expiresAt=? WHERE id=?').run(Date.now()-1,share.id);
    assert.equal((await f.request('/shared/'+share.id,fresh)).status,410);
  }finally{await f.close();}
});
test('revocation during media preparation, account disable and deleted source prevent access',async()=>{
  const f=await fixture();try{
    const share=await f.create(),guest=await f.enter(share);
    const original=f.runtime.media.get.bind(f.runtime.media);let release,entered;
    const started=new Promise(r=>{entered=r;});f.runtime.media.get=async(...args)=>{entered();await new Promise(r=>{release=r;});return original(...args);};
    const pending=f.request(`/shared/${share.id}/media/${f.ids[0]}/thumb`,guest);await started;
    await f.request('/shares/'+share.id,f.cookie,'DELETE');release();assert.equal((await pending).status,410);f.runtime.media.get=original;
    const second=await f.create(),guest2=await f.enter(second);
    f.runtime.store.db.prepare('UPDATE users SET active=0 WHERE id=?').run(f.owner.id);
    assert.equal((await f.request('/shared/'+second.id,guest2)).status,410);
    f.runtime.store.db.prepare('UPDATE users SET active=1 WHERE id=?').run(f.owner.id);
    f.runtime.store.removeSource(f.source.id);
    assert.equal((await(await f.request('/shared/'+second.id,guest2)).json()).items.length,0);
    assert.equal((await f.request(`/shared/${second.id}/media/${f.ids[0]}/thumb`,guest2)).status,404);
  }finally{await f.close();}
});
test('share revision changes only with shared content, not private additions or changes',async()=>{
  const f=await fixture();try{
    const share=await f.create(),guest=await f.enter(share),base='/shared/'+share.id;
    const first=await(await f.request(base,guest)).json();assert.equal(typeof first.revision,'string');
    const change=id=>{const row=f.runtime.store.db.prepare('SELECT payload FROM assets WHERE id=?').get(id),asset=JSON.parse(row.payload);asset.version+='-changed';f.runtime.store.db.prepare('UPDATE assets SET payload=? WHERE id=?').run(JSON.stringify(asset),id);f.runtime.store.bumpVersion(f.owner.id);};
    change(f.ids[1]);assert.equal((await(await f.request(base,guest)).json()).revision,first.revision);
    change(f.ids[0]);const changed=await(await f.request(base,guest)).json();assert.notEqual(changed.revision,first.revision);
    f.runtime.store.db.prepare('DELETE FROM assets WHERE id=?').run(f.ids[0]);const removed=await(await f.request(base,guest)).json();assert.equal(removed.total,0);assert.notEqual(removed.revision,changed.revision);
  }finally{await f.close();}
});

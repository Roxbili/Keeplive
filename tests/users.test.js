import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

async function fixture(options={}){
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-users-'));
  const runtime=createApp({dataDir:path.join(base,'data'),...options});
  const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  async function request(url,method='GET',body,cookie='',extra={}){return fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',...extra},body:body?JSON.stringify(body):undefined});}
  async function login(username,password){const response=await request('/auth/login','POST',{username,password});assert.equal(response.status,200);return response.headers.get('set-cookie').split(';')[0];}
  async function setup(){const r=await request('/auth/setup','POST',{username:'owner',displayName:'相册主人',password:'owner-password'});assert.equal(r.status,201);return r.headers.get('set-cookie').split(';')[0];}
  return {base,runtime,request,login,setup,async close(){await new Promise(r=>server.close(r));await runtime.close();await rm(base,{recursive:true,force:true});}};
}

test('first local account becomes administrator without an initialization code; setup closes permanently', async()=>{
  const f=await fixture();try{
    const status=await (await f.request('/auth/status')).json();assert.equal(status.setupAllowed,true);
    const cookie=await f.setup();
    const me=await (await f.request('/auth/me','GET',undefined,cookie)).json();assert.equal(me.username,'owner');assert.equal(me.role,'admin');assert.equal(me.displayName,'相册主人');assert.equal(me.hash,undefined);
    assert.equal((await f.request('/auth/setup','POST',{username:'other',password:'other-password'})).status,409);
    assert.equal((await (await f.request('/auth/status')).json()).setup,false);
  }finally{await f.close();}
});

test('a proxied first setup is rejected even when its last hop is loopback',async()=>{
  const f=await fixture();try{
    const r=await f.request('/auth/setup','POST',{username:'owner',password:'owner-password'},'',{'X-Forwarded-For':'100.64.1.2'});assert.equal(r.status,403);
  }finally{await f.close();}
});

test('members can manage their own library but cannot administer users or see another source',async()=>{
  const f=await fixture();try{
    const admin=await f.setup();
    const create=await f.request('/users','POST',{username:'guest',displayName:'家人',password:'guest-password',role:'member'},admin);assert.equal(create.status,201);
    const member=await f.login('guest','guest-password');
    assert.equal((await f.request('/users','GET',undefined,member)).status,403);
    assert.equal((await f.request('/sources','GET',undefined,member)).status,200);
    assert.equal((await f.request('/scan','POST',{},member)).status,202);await f.runtime.library.current;
    assert.equal((await f.request('/users','POST',{username:'intruder',password:'other-password',role:'admin'},member)).status,403);
    const owner=await(await f.request('/auth/me','GET',undefined,admin)).json();
    const folder=path.join(f.base,'photos');await mkdir(folder);f.runtime.store.addSource({name:'Private',path:folder,ownerId:owner.id});
    const status=await (await f.request('/status','GET',undefined,member)).json();assert.equal(status.sources.length,0);
    assert.equal((await f.request('/photos','GET',undefined,member)).status,200);
  }finally{await f.close();}
});

test('source, media, downloads and favorites are isolated by the session user',async()=>{
  const f=await fixture();try{
    const admin=await f.setup();const owner=await(await f.request('/auth/me','GET',undefined,admin)).json();
    const root=path.join(f.base,'guest-photos');await mkdir(root);
    const created=await f.request('/users','POST',{username:'guest',password:'guest-password',role:'member',allowedRoots:[root]},admin);assert.equal(created.status,201);const guest=await created.json();const member=await f.login('guest','guest-password');
    const source=f.runtime.store.addSource({name:'Owner private',path:path.join(f.base,'owner-photos'),ownerId:owner.id});
    const asset={id:'a'.repeat(24),sourceId:source.id,relative:'a.jpg',folder:'',filename:'a.jpg',kind:'photo',takenAt:'2026-01-01T00:00:00Z',version:'v1'};f.runtime.store.saveAssets(source.id,[asset],true);
    assert.equal((await(await f.request('/photos','GET',undefined,member)).json()).total,0);
    assert.equal((await f.request(`/media/${asset.id}/thumb`,'GET',undefined,member)).status,404);
    assert.equal((await f.request(`/media/${asset.id}/original`,'GET',undefined,member)).status,404);
    assert.equal((await f.request(`/photos/${asset.id}/favorite`,'PATCH',{favorite:true},member)).status,404);
    assert.equal((await f.request(`/sources/${source.id}`,'DELETE',{},member)).status,404);
    assert.equal((await f.request(`/photos?source=${source.id}`,'GET',undefined,member)).status,404);
    assert.equal((await(await f.request('/folders','GET',undefined,member)).json()).length,0);
    const allowed=await f.request('/sources','POST',{name:'My photos',path:root,recursive:true,ownerId:owner.id},member);assert.equal(allowed.status,201);const ownSource=await allowed.json();assert.equal(f.runtime.store.source(ownSource.id).ownerId,guest.id);await f.runtime.library.current;
    assert.equal((await f.request('/sources','POST',{name:'Not permitted',path:f.base},member)).status,403);
    assert.equal((await f.request('/sources','POST',{name:'Overlap',path:root},admin)).status,403);
  }finally{await f.close();}
});

test('old single-password account, photo ownership, favorites and sessions migrate once',async()=>{
  const {Store}=await import('../server/store.js');const {scryptSync,createHash}=await import('node:crypto');
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-legacy-'));const store=new Store(base);
  try{
    const source=store.addSource({name:'Old photos',path:base});const asset={id:'b'.repeat(24),sourceId:source.id,relative:'a.jpg',folder:'',filename:'a.jpg',kind:'photo',takenAt:'2026-01-01T00:00:00Z',version:'old'};store.saveAssets(source.id,[asset],true);store.setFavorite(asset.id,true);
    store.setSetting('account',{salt:'legacy-salt',hash:scryptSync('legacy-password','legacy-salt',64).toString('hex')});
    store.db.prepare('INSERT INTO sessions(token,expires) VALUES (?,?)').run(createHash('sha256').update('old-session').digest('hex'),Date.now()+60_000);
    store.close();
    const upgraded=new Store(base);try{const users=upgraded.users.list();assert.equal(users.length,1);assert.equal(users[0].username,'admin');assert.equal(upgraded.source(source.id).ownerId,users[0].id);assert.equal(upgraded.photos({userId:users[0].id,favorite:true}).total,1);assert.equal(upgraded.db.prepare('SELECT userId FROM sessions').get().userId,users[0].id);assert.equal(upgraded.setting('account'),null);}finally{upgraded.close();}
    const again=new Store(base);try{assert.equal(again.users.list().length,1);}finally{again.close();}
  }finally{await rm(base,{recursive:true,force:true});}
});

test('username is case-insensitive and duplicate names are rejected',async()=>{
  const f=await fixture();try{
    const admin=await f.setup();await f.login('OWNER','owner-password');
    assert.equal((await f.request('/users','POST',{username:'OWNER',password:'other-password',role:'member'},admin)).status,409);
    assert.equal((await f.request('/users','POST',{username:'bad name',password:'other-password',role:'member'},admin)).status,400);
    assert.equal((await f.request('/users','POST',{username:'okay',password:'short',role:'member'},admin)).status,400);
  }finally{await f.close();}
});

test('changing password verifies the old password and invalidates other sessions',async()=>{
  const f=await fixture();try{
    const admin=await f.setup(),second=await f.login('owner','owner-password');
    assert.equal((await f.request('/auth/password','PUT',{currentPassword:'wrong',newPassword:'updated-password'},admin)).status,401);
    const changed=await f.request('/auth/password','PUT',{currentPassword:'owner-password',newPassword:'updated-password'},admin);assert.equal(changed.status,200);
    const current=changed.headers.get('set-cookie').split(';')[0];
    assert.equal((await f.request('/auth/me','GET',undefined,current)).status,200);
    assert.equal((await f.request('/auth/me','GET',undefined,second)).status,401);
    assert.equal((await f.request('/auth/login','POST',{username:'owner',password:'owner-password'})).status,401);
    await f.login('owner','updated-password');
  }finally{await f.close();}
});

test('disabling a member revokes sessions and the last active administrator is protected',async()=>{
  const f=await fixture();try{
    const admin=await f.setup();const me=await(await f.request('/auth/me','GET',undefined,admin)).json();
    const r=await f.request('/users','POST',{username:'guest',password:'guest-password',role:'member'},admin);const member=await r.json();const cookie=await f.login('guest','guest-password');
    assert.equal((await f.request(`/users/${member.id}`,'PATCH',{active:false},admin)).status,200);
    assert.equal((await f.request('/photos','GET',undefined,cookie)).status,401);
    assert.equal((await f.request('/auth/login','POST',{username:'guest',password:'guest-password'})).status,401);
    assert.equal((await f.request(`/users/${me.id}`,'PATCH',{active:false},admin)).status,409);
    assert.equal((await f.request(`/users/${me.id}`,'PATCH',{role:'member'},admin)).status,409);
  }finally{await f.close();}
});

test('scanning and favorites expose only the current owner inventory',async()=>{
  const f=await fixture();try{
    const cookie=await f.setup(),store=f.runtime.store,owner=store.users.find('owner');
    const root=path.join(f.base,'member');await mkdir(root);const guest=await store.users.create({username:'guest',password:'guest-password',allowedRoots:[root]},owner.id);
    const otherRoot=path.join(f.base,'owner');await mkdir(otherRoot);
    const one=store.addSource({name:'Private owner',path:otherRoot,ownerId:owner.id}),two=store.addSource({name:'Private guest',path:root,ownerId:guest.id});
    const seed=(id,s)=>({id:id.repeat(24),sourceId:s.id,relative:'a.jpg',folder:'Trip',filename:'a.jpg',kind:'photo',takenAt:'2026-01-01T00:00:00Z',version:'v1'});
    store.saveAssets(one.id,[seed('c',one)],true);store.saveAssets(two.id,[seed('d',two)],true);store.setFavorite('d'.repeat(24),true,guest.id);
    assert.equal((await(await f.request('/photos?favorite=true','GET',undefined,cookie)).json()).total,0);
    const member=await f.login('guest','guest-password');assert.equal((await(await f.request('/photos?favorite=true','GET',undefined,member)).json()).total,1);
    const status=await(await f.request('/status','GET',undefined,member)).json();assert.equal(status.stats.total,1);assert.equal(status.stats.favorites,1);
    await f.request('/scan','POST',{},member);await f.runtime.library.current;
    assert.equal(store.source(one.id).status,'pending');assert.equal(store.source(two.id).status,'online');assert.equal(store.photos({userId:owner.id}).total,1);
  }finally{await f.close();}
});

test('admin reset invalidates sessions and grants cannot be narrowed around existing sources',async()=>{
  const f=await fixture();try{
    const cookie=await f.setup();const first=path.join(f.base,'member'),other=path.join(f.base,'other');await mkdir(first);await mkdir(other);
    const response=await f.request('/users','POST',{username:'guest',password:'guest-password',allowedRoots:[first]},cookie);const guest=await response.json();const session=await f.login('guest','guest-password');
    f.runtime.store.addSource({name:'Member',path:first,ownerId:guest.id});
    assert.equal((await f.request(`/users/${guest.id}`,'PATCH',{allowedRoots:[other]},cookie)).status,409);
    assert.equal((await f.request(`/users/${guest.id}/password`,'PUT',{newPassword:'reset-password'},cookie)).status,200);
    assert.equal((await f.request('/auth/me','GET',undefined,session)).status,401);await f.login('guest','reset-password');
    assert.equal((await f.request('/users','POST',{username:'overlap',password:'overlap-password',allowedRoots:[first]},cookie)).status,403);
  }finally{await f.close();}
});

test('concurrent initial setup creates exactly one administrator',async()=>{
  const f=await fixture();try{
    const replies=await Promise.all(['first','second'].map(username=>f.request('/auth/setup','POST',{username,password:'initial-password'})));
    assert.deepEqual(replies.map(r=>r.status).sort(),[201,409]);assert.equal(f.runtime.store.users.count(),1);
  }finally{await f.close();}
});

test('an administrator logout cancels an in-flight account creation',async()=>{
  const f=await fixture();try{
    const cookie=await f.setup(),users=f.runtime.store.users,original=users.roots.bind(users);let enter,release;
    const entered=new Promise(r=>{enter=r;}),blocked=new Promise(r=>{release=r;});users.roots=async(...args)=>{enter();await blocked;return original(...args);};
    const pending=f.request('/users','POST',{username:'pending',password:'pending-password'},cookie);await entered;
    await f.request('/auth/logout','POST',{},cookie);release();assert.equal((await pending).status,401);assert.equal(users.find('pending'),null);
  }finally{await f.close();}
});

test('a changed granted root cannot become a broader permission through a junction',async()=>{
  const {symlink}=await import('node:fs/promises');const f=await fixture();try{
    const cookie=await f.setup(),root=path.join(f.base,'granted'),outside=path.join(f.base,'outside');await mkdir(root);await mkdir(outside);
    await f.request('/users','POST',{username:'guest',password:'guest-password',allowedRoots:[root]},cookie);const session=await f.login('guest','guest-password');
    await rm(root,{recursive:true});await symlink(outside,root,'junction');
    assert.equal((await f.request('/sources','POST',{name:'Changed root',path:root},session)).status,403);
  }finally{await f.close();}
});

test('configured public domain still permits real local first setup but rejects unrelated origins',async()=>{
  const f=await fixture({publicOrigin:'https://photos.example.com'});try{
    const cookie=await f.setup();assert.equal((await f.request('/auth/me','GET',undefined,cookie)).status,200);
    assert.equal((await f.request('/auth/logout','POST',{},cookie,{Origin:'https://evil.example.com'})).status,403);
    assert.equal((await f.request('/auth/login','POST',{username:'owner',password:'owner-password'},'',{Origin:'https://photos.example.com','X-Forwarded-For':'100.64.1.2'})).status,200);
  }finally{await f.close();}
});

test('a stale browser identity cannot change or log out the newly selected account',async()=>{
  const f=await fixture();try{
    const admin=await f.setup(),owner=f.runtime.store.users.find('owner');const r=await f.request('/users','POST',{username:'guest',password:'guest-password'},admin);const guest=await r.json(),session=await f.login('guest','guest-password');
    const mismatch={'X-Keeplive-Expected':owner.id};
    const blocked=await f.request('/auth/me','PATCH',{displayName:'Wrong account'},session,mismatch);assert.equal(blocked.status,409);assert.equal(blocked.headers.get('X-Keeplive-User'),guest.id);
    assert.equal((await f.request('/auth/logout','POST',{},session,mismatch)).status,409);assert.equal((await f.request('/auth/me','GET',undefined,session)).status,200);assert.equal(f.runtime.store.users.get(guest.id).displayName,'guest');
  }finally{await f.close();}
});

test('all password-setting routes accept eight characters and reject seven',async()=>{
  const f=await fixture();try{
    assert.equal((await f.request('/auth/setup','POST',{username:'eight',password:'seven12'})).status,400);
    const setup=await f.request('/auth/setup','POST',{username:'eight',password:'start123'});assert.equal(setup.status,201);let cookie=setup.headers.get('set-cookie').split(';')[0];
    assert.equal((await f.request('/users','POST',{username:'guest',password:'seven12'},cookie)).status,400);
    const created=await f.request('/users','POST',{username:'guest',password:'member12'},cookie);assert.equal(created.status,201);const guest=await created.json();await f.login('guest','member12');
    assert.equal((await f.request('/auth/password','PUT',{currentPassword:'start123',newPassword:'seven12'},cookie)).status,400);
    const changed=await f.request('/auth/password','PUT',{currentPassword:'start123',newPassword:'changed1'},cookie);assert.equal(changed.status,200);cookie=changed.headers.get('set-cookie').split(';')[0];await f.login('eight','changed1');
    assert.equal((await f.request(`/users/${guest.id}/password`,'PUT',{newPassword:'seven12'},cookie)).status,400);
    assert.equal((await f.request(`/users/${guest.id}/password`,'PUT',{newPassword:'reset123'},cookie)).status,200);await f.login('guest','reset123');
  }finally{await f.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app.js';

test('native folder selection is authenticated and local-only; paths remain confined and cancellation changes nothing',async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-native-'));
  const own=path.join(base,'照片 $() 与单引号\''),other=path.join(base,'其他相册');await mkdir(own);await mkdir(other);
  let selected=own,calls=0,choose=async()=>selected;
  const nativePicker={supported:true,async pick(initial,options){calls++;return choose(initial,options);},async close(){}};
  const runtime=createApp({dataDir:path.join(base,'.data'),nativePicker,publicOrigin:'https://album.example'});
  const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(url,cookie='',method='GET',body,headers={})=>new Promise((resolve,reject)=>{
    const outgoing=httpRequest(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json',...headers}},response=>{const chunks=[];response.on('data',chunk=>chunks.push(chunk));response.on('end',()=>resolve(new Response(Buffer.concat(chunks),{status:response.statusCode,headers:response.headers})));});
    outgoing.on('error',reject);outgoing.end(body?JSON.stringify(body):undefined);
  });
  const pick=(cookie,headers={})=>request('/directories/native',cookie,'POST',{path:''},headers);
  try{
    assert.equal((await request('/directories/native')).status,401);assert.equal((await pick('')).status,401);
    const setup=await request('/auth/setup','','POST',{username:'owner',password:'owner-password'}),admin=setup.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await(await request('/directories/native',admin)).json(),{available:true});
    for(const headers of [{'X-Forwarded-For':'192.0.2.1'},{Forwarded:'for=192.0.2.1'},{Host:'album.example',Origin:'https://album.example'}]){
      assert.deepEqual(await(await request('/directories/native',admin,'GET',undefined,headers)).json(),{available:false},JSON.stringify(headers));
      assert.equal((await pick(admin,headers)).status,403);
    }
    assert.equal(calls,0,'Remote requests never open a desktop window');
    assert.equal((await pick(admin,{Origin:'https://unrelated.example'})).status,403);
    assert.equal((await pick(admin,{Origin:'https://album.example'})).status,403,'A configured public Origin never activates the local desktop, even if a proxy rewrites Host');
    const first=await pick(admin);assert.equal(first.status,200);assert.equal((await first.json()).path,own);assert.equal(runtime.store.sources(admin.id).length,0,'Choosing does not save a source');
    selected=null;assert.deepEqual(await(await pick(admin)).json(),{path:null,canceled:true});
    const created=await request('/users',admin,'POST',{username:'member',password:'member-password',allowedRoots:[own]});assert.equal(created.status,201);
    const login=await request('/auth/login','','POST',{username:'member',password:'member-password'}),member=login.headers.get('set-cookie').split(';')[0];
    selected=other;assert.equal((await pick(member)).status,403);
    selected=path.join(base,'.data');assert.equal((await pick(admin)).status,400);
    selected=own;assert.equal((await pick(admin)).status,403,'Other user roots remain protected');
    assert.equal((await pick(member)).status,200);
    let release,opened;const ready=new Promise(resolve=>opened=resolve);choose=()=>new Promise(resolve=>{release=resolve;opened();});
    const pending=pick(member);await ready;await request('/auth/logout',member,'POST',{});release(own);assert.equal((await pending).status,401,'A logged-out request never receives the selected path');
    nativePicker.supported=false;assert.deepEqual(await(await request('/directories/native',admin)).json(),{available:false});assert.equal((await pick(admin)).status,409);
  }finally{await new Promise(resolve=>server.close(resolve));await runtime.close();await rm(base,{recursive:true,force:true});}
});

test('disconnect during initial path validation never opens a desktop window',async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-native-disconnect-')),folder=path.join(base,'photos');await mkdir(folder);
  let invoked=0,entered,release,disconnected;
  const ready=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),closed=new Promise(resolve=>disconnected=resolve);
  const runtime=createApp({dataDir:path.join(base,'.data'),nativePicker:{supported:true,async pick(){invoked++;return folder;},async close(){}}});
  const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const setup=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'owner-password'})});
    const cookie=setup.headers.get('set-cookie').split(';')[0],original=runtime.store.users.assertSource.bind(runtime.store.users);
    runtime.store.users.assertSource=async(...args)=>{entered();await gate;return original(...args);};
    server.on('request',(_req,res)=>res.once('close',disconnected));
    const outgoing=httpRequest(origin+'/api/directories/native',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'}});outgoing.on('error',()=>{});outgoing.end(JSON.stringify({path:folder}));
    await ready;outgoing.destroy();await closed;release();await new Promise(resolve=>setTimeout(resolve,30));assert.equal(invoked,0);
  }finally{release();await new Promise(resolve=>server.close(resolve));await runtime.close();await rm(base,{recursive:true,force:true});}
});

test('a migrated Windows source opens a new local picker instead of rejecting its old path',{skip:process.platform==='win32'},async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-migrated-picker-')),folder=path.join(base,'Mac照片');await mkdir(folder);
  let initial,calls=0;
  const runtime=createApp({dataDir:path.join(base,'data'),nativePicker:{supported:true,async pick(hint){initial=hint;calls++;return folder;},async close(){}}});
  const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const setup=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'owner',password:'migration-test-password'})});
    const cookie=setup.headers.get('set-cookie').split(';')[0];
    const request=hint=>fetch(origin+'/api/directories/native',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({path:hint})});
    const selected=await request('E:\\旧照片\\旅行');assert.equal(selected.status,200);assert.equal((await selected.json()).path,folder);assert.equal(initial,'');assert.equal(calls,1);
    assert.equal((await request('relative/folder')).status,400);assert.equal(calls,1,'Ordinary relative paths are still rejected');
    const browse=await fetch(origin+'/api/directories?path='+encodeURIComponent('E:\\旧照片\\旅行'),{headers:{Cookie:cookie}});
    assert.equal(browse.status,200);assert.equal((await browse.json()).path,null,'The web fallback starts at local locations for migrated Windows paths');
    assert.equal(runtime.store.sources().length,0,'Picking a replacement never changes the old source by itself');
  }finally{await new Promise(resolve=>server.close(resolve));await runtime.close();await rm(base,{recursive:true,force:true});}
});

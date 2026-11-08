import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,symlink,rm,realpath } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

test('folder selection lists directories only, confines members and derives source names',async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-directories-'));
  const own=path.join(base,'我的照片'),other=path.join(base,'其他相册'),child=path.join(own,'旅行');
  await mkdir(child,{recursive:true});await mkdir(other);
  await writeFile(path.join(own,'private.txt'),'not a folder');
  await symlink(other,path.join(own,'escape'),process.platform==='win32'?'junction':'dir');
  const runtime=createApp({dataDir:path.join(base,'.data')});
  const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(url,cookie='',method='GET',body)=>fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const browse=(p,cookie)=>request('/directories'+(p?'?path='+encodeURIComponent(p):''),cookie);
  try{
    assert.equal((await browse()).status,401);
    const setup=await request('/auth/setup','','POST',{username:'owner',password:'owner-password'}),admin=setup.headers.get('set-cookie').split(';')[0];
    const created=await request('/users',admin,'POST',{username:'member',password:'member-password',allowedRoots:[own]});assert.equal(created.status,201);
    const login=await request('/auth/login','','POST',{username:'member',password:'member-password'}),member=login.headers.get('set-cookie').split(';')[0];
    const rootsResponse=await browse('',member);assert.equal(rootsResponse.status,200);
    assert.deepEqual((await rootsResponse.json()).directories.map(d=>d.path),[await realpath(own)]);
    const listing=await(await browse(own,member)).json();assert.equal(listing.path,await realpath(own));assert.equal(listing.parent,null);assert.equal(listing.selectable,true);
    assert.deepEqual(listing.directories.map(d=>d.name),['旅行']);
    for(const forbidden of [base,other,path.join(own,'escape'),path.join(own,'..','其他相册')])assert.equal((await browse(forbidden,member)).status,403);
    assert.equal((await browse(path.join(base,'.data'),admin)).status,403);
    const parentListing=await(await browse(base,admin)).json();assert.equal(parentListing.selectable,false);
    assert.equal(parentListing.directories.some(d=>d.name==='我的照片'||d.name==='.data'),false);
    const added=await request('/sources',member,'POST',{path:child,recursive:true});assert.equal(added.status,201);
    const source=await added.json();assert.equal(source.name,'旅行');await runtime.library.current;
    const updated=await request('/sources/'+source.id,member,'PATCH',{path:own,name:'不使用自定义名称'});assert.equal(updated.status,200);assert.equal((await updated.json()).name,'我的照片');await runtime.library.current;
    assert.equal((await browse('relative-path',admin)).status,400);
  }finally{await new Promise(r=>server.close(r));await runtime.close();await rm(base,{recursive:true,force:true});}
});

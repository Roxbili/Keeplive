import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { createApp } from '../server/app.js';

test('playback preferences default to original quality, persist per user and reject invalid values',async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-preferences-'));
  const runtime=createApp({dataDir:base}),server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(url,cookie='',method='GET',body)=>fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  try{
    assert.equal((await request('/preferences')).status,401);
    const setup=await request('/auth/setup','','POST',{username:'owner',password:'owner-password'}),admin=setup.headers.get('set-cookie').split(';')[0];
    assert.deepEqual((await(await request('/auth/status',admin)).json()).playback,{liveSound:true,videoSound:true,videoQuality:'original'});
    const updated=await request('/preferences',admin,'PATCH',{liveSound:false});assert.equal(updated.status,200);
    assert.deepEqual(await updated.json(),{liveSound:false,videoSound:true,videoQuality:'original'});
    assert.deepEqual((await(await request('/auth/status',admin)).json()).playback,{liveSound:false,videoSound:true,videoQuality:'original'});
    for(const quality of ['high','smooth','original']){
      const response=await request('/preferences',admin,'PATCH',{videoQuality:quality});assert.equal(response.status,200);
      assert.equal((await response.json()).videoQuality,quality);
    }
    await request('/preferences',admin,'PATCH',{videoQuality:'high'});
    for(const value of ['4k','../original',true,null,['original']])assert.equal((await request('/preferences',admin,'PATCH',{videoQuality:value})).status,400);
    assert.equal((await request('/preferences',admin,'PATCH',{videoQuality:'smooth',videoSound:'false'})).status,400);
    assert.equal((await request('/preferences',admin,'PATCH',{videoSound:'false'})).status,400);
    assert.equal((await request('/preferences',admin,'PATCH',{liveSound:null})).status,400);
    assert.equal((await request('/preferences',admin,'PATCH',{unknown:true})).status,400);
    await request('/users',admin,'POST',{username:'member',password:'member-password'});
    const login=await request('/auth/login','','POST',{username:'member',password:'member-password'}),member=login.headers.get('set-cookie').split(';')[0];
    assert.deepEqual(await(await request('/preferences',member)).json(),{liveSound:true,videoSound:true,videoQuality:'original'});
    await request('/preferences',member,'PATCH',{videoSound:false});
    assert.deepEqual(await(await request('/preferences',admin)).json(),{liveSound:false,videoSound:true,videoQuality:'high'});
    const {Store}=await import('../server/store.js');const reopened=new Store(base);
    try{assert.deepEqual(reopened.setting('playback:'+runtime.store.users.find('owner').id),{liveSound:false,videoSound:true,videoQuality:'high'});}finally{reopened.close();}
    runtime.store.setSetting('playback:'+runtime.store.users.find('owner').id,{liveSound:false,videoSound:true});
    assert.deepEqual(await(await request('/preferences',admin)).json(),{liveSound:false,videoSound:true,videoQuality:'original'});
  }finally{await new Promise(r=>server.close(r));await runtime.close();await rm(base,{recursive:true,force:true});}
});

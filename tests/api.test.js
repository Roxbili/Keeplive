import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';

test('private media requires login; local setup, CSRF, directory scan, favorites and logout work', async () => {
  const { createApp } = await import('../server/app.js');
  const sharp=(await import('sharp')).default;
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-api-'));
  const source=path.join(base,'旅行');await mkdir(source);
  await sharp({create:{width:32,height:24,channels:3,background:'#123456'}}).jpeg().toFile(path.join(source,'IMG_1.jpg'));
  const runtime=createApp({dataDir:path.join(base,'.data'),setupToken:'test-initialization-code'});
  const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;let cookie='';
  const request=(url,method='GET',body)=>fetch(origin+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  try{
    assert.equal((await request('/api/photos')).status,401);
    assert.equal((await request('/api/media/unknown/thumb')).status,401);
    assert.equal((await request('/api/auth/setup','POST',{username:'admin',password:'short'})).status,400);
    const setup=await request('/api/auth/setup','POST',{username:'admin',password:'a-long-password'});
    assert.equal(setup.status,201);cookie=setup.headers.get('set-cookie').split(';')[0];
    const cross=await fetch(origin+'/api/sources',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test','Content-Type':'application/json'},body:JSON.stringify({name:'x',path:source})});
    assert.equal(cross.status,403);
    assert.equal((await request('/api/sources','POST',{name:'旅行',path:source,recursive:true})).status,201);
    await runtime.library.current;
    const response=await request('/api/photos');assert.equal(response.status,200);
    const photos=await response.json();assert.equal(photos.total,1);
    assert.equal(JSON.stringify(photos).includes(source),false);
    const id=photos.items[0].id;
    const detail=await request('/api/photos/'+id);assert.equal(detail.status,200);assert.equal((await detail.text()).includes(source),false);
    const thumb=await request(`/api/media/${id}/thumb`);assert.equal(thumb.status,200);assert.equal(thumb.headers.get('content-type'),'image/jpeg');
    const meta=await sharp(Buffer.from(await thumb.arrayBuffer())).metadata();assert.equal(meta.width,32);
    assert.equal((await request(`/api/photos/${id}/favorite`,'PATCH',{favorite:true})).status,200);
    assert.equal((await (await request('/api/photos?favorite=true')).json()).total,1);
    const original=await request(`/api/media/${id}/original`);assert.equal(original.status,200);assert.match(original.headers.get('content-disposition'),/attachment/);
    assert.equal((await request('/api/auth/logout','POST',{})).status,200);
    assert.equal((await request(`/api/media/${id}/thumb`)).status,401);
    assert.equal((await request('/api/auth/login','POST',{username:'admin',password:'incorrect'})).status,401);
    assert.equal((await request('/api/auth/login','POST',{username:'admin',password:'a-long-password'})).status,200);
  }finally{await new Promise(r=>server.close(r));await runtime.close();await rm(base,{recursive:true,force:true});}
});

test('real video transcode is browser-compatible and serves byte ranges', async () => {
  const { createApp } = await import('../server/app.js');
  const ffmpeg=(await import('ffmpeg-static')).default;
  const sharp=(await import('sharp')).default;
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-video-'));const folder=path.join(base,'photos');await mkdir(folder);
  await sharp({create:{width:64,height:48,channels:3,background:'#446677'}}).jpeg().toFile(path.join(folder,'live.jpg'));
  const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i','color=c=blue:s=64x48:d=0.3','-c:v','libx264','-pix_fmt','yuv420p',path.join(folder,'live.mov')]);
  assert.equal(result.status,0,result.stderr.toString());
  const runtime=createApp({dataDir:path.join(base,'data'),setupToken:'video-code'});
  const server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const login=await fetch(origin+'/api/auth/setup',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'video-password'})});
    const cookie=login.headers.get('set-cookie').split(';')[0];
    runtime.store.addSource({name:'Live',path:folder,recursive:true,ownerId:runtime.store.users.find('admin').id});await runtime.library.scan();
    const a=runtime.store.photos({}).items[0];assert.equal(a.kind,'live');
    const res=await fetch(`${origin}/api/media/${a.id}/video`,{headers:{Cookie:cookie,Range:'bytes=0-31'}});
    assert.equal(res.status,206);assert.equal((await res.arrayBuffer()).byteLength,32);assert.match(res.headers.get('content-range'),/^bytes 0-31\//);assert.equal(res.headers.get('content-type'),'video/mp4');
    const dimensions=async quality=>{
      const response=await fetch(`${origin}/api/media/${a.id}/video?quality=${quality}`,{headers:{Cookie:cookie}});assert.equal(response.status,200);
      await response.arrayBuffer();const file=(await runtime.media.get(a.id,'video',quality)).file;
      const tags=await runtime.library.exif.read(file);assert.deepEqual([tags.ImageWidth,tags.ImageHeight],[64,48]);
    };
    await dimensions('original');await dimensions('smooth');
    for(const query of ['quality=unknown','quality=original&quality=smooth'])assert.equal((await fetch(`${origin}/api/media/${a.id}/video?${query}`,{headers:{Cookie:cookie}})).status,400);
    const saved=await fetch(origin+'/api/preferences',{method:'PATCH',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({videoQuality:'high'})});assert.equal(saved.status,200);
    const high=await runtime.media.get(a.id,'video','high');
    const preferred=await fetch(`${origin}/api/media/${a.id}/video`,{headers:{Cookie:cookie}});
    assert.deepEqual(Buffer.from(await preferred.arrayBuffer()),await readFile(high.file));
    const created=await fetch(origin+'/api/shares',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({ids:[a.id]})});assert.equal(created.status,201);const share=await created.json();
    const access=await fetch(`${origin}/api/shared/${share.id}/access`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:share.link.split('#')[1]})});assert.equal(access.status,200);const guest=access.headers.get('set-cookie').split(';')[0];
    const sharedBase=`${origin}/api/shared/${share.id}/media/${a.id}`;
    const sharedHigh=await fetch(sharedBase+'/video?quality=high',{headers:{Cookie:guest}});assert.equal(sharedHigh.status,200);assert.deepEqual(Buffer.from(await sharedHigh.arrayBuffer()),await readFile(high.file));
    const sharedDefault=await fetch(sharedBase+'/video',{headers:{Cookie:guest}});assert.equal(sharedDefault.status,200);
    assert.deepEqual(Buffer.from(await sharedDefault.arrayBuffer()),await readFile((await runtime.media.get(a.id,'video','original')).file));
    for(const variant of ['original','motion-original'])assert.equal((await fetch(sharedBase+'/'+variant+'?quality=original',{headers:{Cookie:guest}})).status,403);
    assert.equal((await fetch(sharedBase+'/video?quality=invalid',{headers:{Cookie:guest}})).status,400);
  }finally{await new Promise(r=>server.close(r));await runtime.close();await rm(base,{recursive:true,force:true});}
});

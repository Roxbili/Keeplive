import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,rename} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {once} from 'node:events';
import {crc32} from 'node:zlib';
import sharp from 'sharp';
import {createApp} from '../server/app.js';

function contents(zip){
  const end=zip.length-22;assert.equal(zip.readUInt32LE(end),0x06054b50);const result=new Map();let offset=zip.readUInt32LE(end+16);
  for(let i=0;i<zip.readUInt16LE(end+10);i++){
    assert.equal(zip.readUInt32LE(offset),0x02014b50);assert.equal(zip.readUInt16LE(offset+10),0,'originals are stored without re-encoding');
    const size=zip.readUInt32LE(offset+20),nameLength=zip.readUInt16LE(offset+28),extra=zip.readUInt16LE(offset+30),comment=zip.readUInt16LE(offset+32),local=zip.readUInt32LE(offset+42);
    const name=zip.subarray(offset+46,offset+46+nameLength).toString('utf8'),start=local+30+zip.readUInt16LE(local+26)+zip.readUInt16LE(local+28),data=zip.subarray(start,start+size);
    assert.equal(crc32(data),zip.readUInt32LE(offset+16));assert.equal(name.includes('/'),false);assert.equal(result.has(name),false);result.set(name,data);offset+=46+nameLength+extra+comment;
  }
  return result;
}
async function fixture(){
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-download-')),root=path.join(base,'photos');await mkdir(root);
  await sharp({create:{width:32,height:24,channels:3,background:'#123456'}}).jpeg().toFile(path.join(root,'旅行.jpg'));
  const video=Buffer.from('original movie bytes, including preserved metadata');await writeFile(path.join(root,'旅行.mov'),video);
  const runtime=createApp({dataDir:path.join(base,'data')}),server=runtime.app.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${server.address().port}`;
  const request=(url,cookie='',method='GET',body)=>fetch(origin+'/api'+url,{method,headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  const response=await request('/auth/setup','','POST',{username:'owner',password:'download-test-password'}),cookie=response.headers.get('set-cookie').split(';')[0],owner=runtime.store.users.find('owner');
  const source=runtime.store.addSource({name:'Photos',path:root,ownerId:owner.id}),id='a'.repeat(24);
  runtime.store.saveAssets(source.id,[{id,sourceId:source.id,relative:'旅行.jpg',filename:'旅行.jpg',folder:'',kind:'live',takenAt:new Date().toISOString(),version:'fixture',video:{relative:'旅行.mov'}}],false);
  const share=runtime.shares.create(owner.id,{ids:[id]}),entry=await request('/shared/'+share.id+'/access','','POST',{token:share.link.split('#')[1]}),guest=entry.headers.get('set-cookie').split(';')[0];
  return {base,root,runtime,source,id,owner,cookie,share,guest,request,async close(){await new Promise(r=>server.close(r));await runtime.close();await rm(base,{recursive:true,force:true});}};
}
test('one live download contains both untouched originals; guest download permission and album access remain confined',async()=>{
  const f=await fixture();try{
    const privateURL='/media/'+f.id+'/download',sharedURL=`/shared/${f.share.id}/media/${f.id}/download`;
    assert.equal((await f.request(privateURL)).status,401);assert.equal((await f.request(sharedURL,f.guest)).status,403);
    const response=await f.request(privateURL,f.cookie);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment;.*\.zip/);
    const zip=contents(Buffer.from(await response.arrayBuffer()));assert.deepEqual([...zip.keys()].sort(),['旅行.jpg','旅行.mov']);
    for(const [name,bytes] of zip)assert.deepEqual(bytes,await readFile(path.join(f.root,name)));
    f.runtime.shares.update(f.share.id,f.owner.id,{allowDownload:true});
    const shared=await f.request(sharedURL,f.guest);assert.equal(shared.status,200);assert.deepEqual(Buffer.from(await shared.arrayBuffer()),await readFile((await f.runtime.media.get(f.id,'download')).file));
    assert.equal((await f.request(`/shared/${f.share.id}/media/${'b'.repeat(24)}/download`,f.guest)).status,404);
    assert.equal((await f.request(privateURL,f.guest)).status,401);
    f.runtime.shares.update(f.share.id,f.owner.id,{allowDownload:false});assert.equal((await f.request(sharedURL,f.guest)).status,403,'cached ZIP must not bypass permissions');
    await rename(path.join(f.root,'旅行.mov'),path.join(f.root,'missing.mov'));assert.notEqual((await f.request(privateURL,f.cookie)).status,200,'cached ZIP cannot hide a missing half');
  }finally{await f.close();}
});
test('share revocation during live ZIP preparation blocks the completed download',async()=>{
  const f=await fixture();try{
    f.runtime.shares.update(f.share.id,f.owner.id,{allowDownload:true});const original=f.runtime.media.get.bind(f.runtime.media);let release,entered;
    const started=new Promise(r=>{entered=r;});f.runtime.media.get=async(...args)=>{entered();await new Promise(r=>{release=r;});return original(...args);};
    const response=f.request(`/shared/${f.share.id}/media/${f.id}/download`,f.guest);await started;f.runtime.shares.revoke(f.share.id,f.owner.id);release();assert.equal((await response).status,410);
  }finally{await f.close();}
});

test('the unified download still returns a single untouched file for ordinary photos and videos',async()=>{
  const f=await fixture();try{
    const live=f.runtime.store.asset(f.id,f.owner.id);
    for(const [id,kind,relative] of [['b'.repeat(24),'photo','旅行.jpg'],['c'.repeat(24),'video','旅行.mov']]){
      f.runtime.store.saveAssets(f.source.id,[{...live,id,kind,relative,filename:relative,video:undefined}],false);
      const response=await f.request('/media/'+id+'/download',f.cookie);assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment/);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()),await readFile(path.join(f.root,relative)));
    }
  }finally{await f.close();}
});

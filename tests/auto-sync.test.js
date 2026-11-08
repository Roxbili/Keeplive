import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,rename,rm } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../server/store.js';
import { Library } from '../server/library.js';
import { AutoSync } from '../server/auto-sync.js';

const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(condition){const end=Date.now()+10000;while(Date.now()<end){if(condition())return;await pause(25);}assert.fail('Automatic synchronization did not finish');}
async function fixture(options={}){
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-auto-')),root=path.join(base,'photos');await mkdir(root);
  const image=await(await import('sharp')).default({create:{width:8,height:8,channels:3,background:'#667788'}}).png().toBuffer();
  const store=new Store(path.join(base,'data')),library=new Library(store),source=store.addSource({name:'Photos',path:root});
  const sync=new AutoSync(store,library,{debounceMs:30,maxWaitMs:100,watchIntervalMs:40,pollIntervalMs:150,...options});await sync.start();
  return {base,root,image,store,library,source,sync,async close(){await sync.close();await library.close();store.close();await rm(base,{recursive:true,force:true});}};
}
test('native watch automatically indexes added/deleted photos and replaces source watches',async()=>{
  const f=await fixture({pollIntervalMs:60000});try{
    await until(()=>!f.library.current);
    await writeFile(path.join(f.root,'new.png'),f.image);await until(()=>f.store.photos({}).total===1);
    await rm(path.join(f.root,'new.png'));await until(()=>f.store.photos({}).total===0);
    const next=path.join(f.base,'next');await mkdir(next);f.store.updateSource(f.source.id,{path:next});
    await until(()=>f.sync.watchers.get(f.source.id)?.path===next);
    await writeFile(path.join(next,'next.png'),f.image);await until(()=>f.store.photos({}).total===1);
    assert.equal(f.store.photos({}).items[0].filename,'next.png');
  }finally{await f.close();}
});
test('periodic compensation works without native watches; disconnect preserves records and reconnect recovers',async()=>{
  const f=await fixture({watchFactory(){throw new Error('watch unavailable');}});try{
    await writeFile(path.join(f.root,'a.png'),f.image);await until(()=>f.store.photos({}).total===1);
    const parked=path.join(f.base,'parked');await rename(f.root,parked);await until(()=>f.store.source(f.source.id).status==='offline');assert.equal(f.store.photos({}).total,1);
    await rename(parked,f.root);await until(()=>f.store.source(f.source.id).status==='online');
    await rm(path.join(f.root,'a.png'));await until(()=>f.store.photos({}).total===0);
  }finally{await f.close();}
});
test('changes during another scan are queued again rather than lost; close releases watches',async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-auto-queue-'));let callback,calls=0,finish;
  const store={sources:()=>[{id:'source',ownerId:'owner',path:base,recursive:true}]};
  const library={current:null,scan(){calls++;const promise=new Promise(resolve=>{finish=()=>{library.current=null;resolve();};});library.current=promise;return promise;}};
  const handles=[],sync=new AutoSync(store,library,{debounceMs:10,maxWaitMs:30,pollIntervalMs:60000,watchIntervalMs:60000,watchFactory(_path,_options,listener){callback=listener;const handle=new EventEmitter();handle.close=()=>{handle.closed=true;};handles.push(handle);return handle;}});
  try{await sync.start();await until(()=>calls===1);callback('change','a.jpg');await pause(50);assert.equal(calls,1);finish();await until(()=>calls===2);finish();await sync.close();assert.ok(handles.every(handle=>handle.closed));}
  finally{if(library.current)finish();await sync.close();await rm(base,{recursive:true,force:true});}
});

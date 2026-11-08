import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('pairs content identifiers across names and never overrides conflicting identifiers', async () => {
  const { pairMedia } = await import('../server/library.js');
  const files = [
    { relative:'a.jpg', kind:'photo', contentId:'one' },
    { relative:'renamed.mov', kind:'video', contentId:'one' },
    { relative:'b.jpg', kind:'photo', contentId:'two' },
    { relative:'b.mov', kind:'video', contentId:'three' },
  ];
  const paired = pairMedia(files);
  assert.equal(paired.find(x => x.relative === 'a.jpg').video.relative, 'renamed.mov');
  assert.equal(paired.find(x => x.relative === 'b.jpg').video, undefined);
  assert.equal(paired.length, 3);
});

test('fallback pairs only unique names in the same folder', async () => {
  const { pairMedia } = await import('../server/library.js');
  const paired = pairMedia([
    { relative:'trip/IMG_1.HEIC', kind:'photo' }, { relative:'trip/IMG_1.MOV', kind:'video' },
    { relative:'other/IMG_1.jpg', kind:'photo' }, { relative:'ambiguous/a.jpg', kind:'photo' },
    { relative:'ambiguous/a.heic', kind:'photo' }, { relative:'ambiguous/a.mov', kind:'video' },
  ]);
  assert.equal(paired.find(x=>x.relative==='trip/IMG_1.HEIC').video.relative, 'trip/IMG_1.MOV');
  assert.equal(paired.find(x=>x.relative==='other/IMG_1.jpg').video, undefined);
  assert.equal(paired.find(x=>x.relative==='ambiguous/a.jpg').video, undefined);
});

test('ambiguous identifiers are not paired by arbitrary file order', async () => {
  const { pairMedia } = await import('../server/library.js');
  const rows = pairMedia([{relative:'a.jpg',kind:'photo',contentId:'x'}, {relative:'b.mov',kind:'video',contentId:'x'}, {relative:'c.mov',kind:'video',contentId:'x'}]);
  assert.equal(rows.length,3);
});

test('scan preserves offline assets and favorites when the root is relocated', async () => {
  const { Store } = await import('../server/store.js');
  const { Library } = await import('../server/library.js');
  const sharp = (await import('sharp')).default;
  const base = await mkdtemp(path.join(tmpdir(),'keeplive-'));
  const folder = path.join(base,'photos'); await mkdir(folder);
  const image = await sharp({create:{width:8,height:8,channels:3,background:'#333'}}).png().toBuffer();
  await writeFile(path.join(folder,'a.png'),image);
  const store = new Store(path.join(base,'data'));
  const library = new Library(store);
  try {
    const source = store.addSource({name:'Trip',path:folder,recursive:true});
    await library.scan();
    const version=store.libraryVersion();await library.scan();assert.equal(store.libraryVersion(),version);
    const id = store.photos({}).items[0].id; store.setFavorite(id,true);
    await rename(folder,path.join(base,'relocated')); await library.scan();
    assert.equal(store.photos({}).total,1);
    assert.equal(store.sources()[0].status,'offline');
    store.updateSource(source.id,{path:path.join(base,'relocated')}); await library.scan();
    assert.equal(store.photos({}).items[0].id,id);
    assert.equal(store.photos({}).items[0].favorite,true);
    await rm(path.join(base,'relocated','a.png')); await library.scan();
    assert.equal(store.photos({}).total,0);
  } finally { await library.close(); store.close(); await rm(base,{recursive:true,force:true}); }
});

test('safe paths reject parent traversal and sibling prefixes', async () => {
  const { resolveInside } = await import('../server/paths.js');
  const base = await mkdtemp(path.join(tmpdir(),'keeplive-path-'));
  try {
    await writeFile(path.join(base,'good.jpg'),'photo');
    assert.equal(await resolveInside(base,'good.jpg'),path.join(base,'good.jpg'));
    await assert.rejects(resolveInside(base,'../escape.jpg'));
    await assert.rejects(resolveInside(base,path.join(base,'good.jpg')));
  } finally { await rm(base,{recursive:true,force:true}); }
});

test('partial scans cannot downgrade a live asset when its video is temporarily unreadable', async () => {
  const { Store } = await import('../server/store.js');
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-partial-'));const store=new Store(base);
  try{
    const s=store.addSource({name:'Photos',path:base});
    const old={id:'a',sourceId:s.id,relative:'a.jpg',folder:'',filename:'a.jpg',takenAt:'2026-01-01T00:00:00Z',kind:'live',version:'one',signature:'1',video:{relative:'a.mov',kind:'video',signature:'2'}};
    store.saveAssets(s.id,[old],true);
    store.saveAssets(s.id,[{...old,kind:'photo',video:undefined}],false);
    assert.equal(store.asset('a').kind,'live');
    assert.equal(store.asset('a').video.relative,'a.mov');
  }finally{store.close();await rm(base,{recursive:true,force:true});}
});

test('metadata read failures are retried on the next unchanged scan', async () => {
  const { Store } = await import('../server/store.js');const { Library }=await import('../server/library.js');
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-retry-')),folder=path.join(base,'photos');await mkdir(folder);
  const file=path.join(folder,'broken.jpg');await writeFile(file,'invalid image data');
  const store=new Store(path.join(base,'data')),library=new Library(store);
  try{
    store.addSource({name:'Photos',path:folder});await library.scan();
    assert.equal(store.sources()[0].status,'partial');
    await library.scan();assert.equal(store.sources()[0].status,'partial');
  }finally{await library.close();store.close();await rm(base,{recursive:true,force:true});}
});

test('a directory junction cannot expose files outside an approved root', async () => {
  const { resolveInside } = await import('../server/paths.js');
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-link-'));
  const root=path.join(base,'photos'),outside=path.join(base,'private');await mkdir(root);await mkdir(outside);await writeFile(path.join(outside,'secret.jpg'),'secret');
  try{
    await symlink(outside,path.join(root,'linked'),'junction');
    await assert.rejects(resolveInside(root,'linked/secret.jpg'),/超出/);
  }finally{await rm(base,{recursive:true,force:true});}
});

test('replacing an approved source root with a junction cannot change its physical scope',async()=>{
  const {resolveInside}=await import('../server/paths.js');const base=await mkdtemp(path.join(tmpdir(),'keeplive-root-link-'));
  const root=path.join(base,'photos'),other=path.join(base,'private');await mkdir(root);await mkdir(other);await writeFile(path.join(other,'secret.jpg'),'secret');
  try{await rm(root,{recursive:true});await symlink(other,root,'junction');await assert.rejects(resolveInside(root,'secret.jpg'),/目录/);}
  finally{await rm(base,{recursive:true,force:true});}
});

test('legacy Windows directory spelling remains online when only letter case differs',async()=>{
  if(process.platform!=='win32')return;
  const {Store}=await import('../server/store.js'),{Library}=await import('../server/library.js');
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-case-')),root=path.join(base,'PhotoFolder');await mkdir(root);
  const store=new Store(path.join(base,'data')),library=new Library(store);
  try{const source=store.addSource({name:'Legacy',path:root.toLowerCase()});await library.scan();assert.equal(store.source(source.id).status,'online');}
  finally{await library.close();store.close();await rm(base,{recursive:true,force:true});}
});

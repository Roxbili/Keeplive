import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import {ExifTool} from 'exiftool-vendored';
import {Media} from '../server/media.js';

test('video quality preserves source resolution, never upscales and separates cached renditions',async()=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-quality-')),folder=path.join(base,'photos');await mkdir(folder);
  const exif=new ExifTool(),assets=new Map(),media=new Media({dataDir:base,asset:id=>assets.get(id)});
  const generate=(name,size,pixelFormat='yuv420p')=>{
    const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-f','lavfi','-i',`testsrc=size=${size}:duration=0.12`,'-c:v','libx264','-pix_fmt',pixelFormat,path.join(folder,name)]);
    assert.equal(result.status,0,result.stderr.toString());
  };
  const dimensions=async file=>{const tags=await exif.read(file);return [tags.ImageWidth,tags.ImageHeight];};
  try{
    generate('wide.mov','2048x1152');generate('portrait.mov','900x1600');generate('small.mov','64x48');generate('odd.mov','65x49','yuv444p');
    assets.set('wide',{kind:'video',version:'1',sourcePath:folder,relative:'wide.mov'});
    assets.set('portrait',{kind:'live',version:'1',sourcePath:folder,relative:'portrait.jpg',video:{relative:'portrait.mov'}});
    assets.set('small',{kind:'video',version:'1',sourcePath:folder,relative:'small.mov'});
    assets.set('odd',{kind:'video',version:'1',sourcePath:folder,relative:'odd.mov'});
    const originalBytes=await readFile(path.join(folder,'wide.mov'));
    await mkdir(media.cache);const legacy=path.join(media.cache,'wide-1-video.mp4');await writeFile(legacy,'old 720p cache');
    const original=await media.get('wide','video','original'),high=await media.get('wide','video','high'),smooth=await media.get('wide','video','smooth');
    assert.notEqual(original.file,legacy,'new original quality must not reuse the old compressed cache');
    assert.deepEqual(await dimensions(original.file),[2048,1152]);
    assert.deepEqual(await dimensions(high.file),[1920,1080]);
    assert.deepEqual(await dimensions(smooth.file),[1280,720]);
    assert.equal(new Set([original.file,high.file,smooth.file,legacy]).size,4);
    assert.equal((await media.get('wide','video')).file,original.file);
    assert.equal((await media.get('wide','video','high')).file,high.file);
    assert.deepEqual(await dimensions((await media.get('portrait','video','original')).file),[900,1600]);
    assert.deepEqual(await dimensions((await media.get('portrait','video','smooth')).file),[720,1280]);
    assert.deepEqual(await dimensions((await media.get('small','video','smooth')).file),[64,48]);
    assert.deepEqual(await dimensions(path.join(folder,'odd.mov')),[65,49]);
    assert.deepEqual(await dimensions((await media.get('odd','video','original')).file),[66,50]);
    assert.deepEqual(await readFile(path.join(folder,'wide.mov')),originalBytes);
    const download=await media.get('wide','original','smooth');assert.equal(download.file,path.join(folder,'wide.mov'));assert.equal(download.download,'wide.mov');
    for(const value of ['../original','bad',null,['original']])await assert.rejects(media.get('wide','video',value),error=>error.status===400);
  }finally{await media.close();await exif.end();await rm(base,{recursive:true,force:true});}
});

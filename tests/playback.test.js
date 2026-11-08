import test from 'node:test';
import assert from 'node:assert/strict';
import * as playback from '../src/playback.ts';
const {playLive,playbackURL,defaultPlayback}=playback;

test('shared visitor quality defaults to original, remembers a valid choice and tolerates unavailable storage',()=>{
  const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  assert.equal(typeof playback.readSharedQuality,'function');
  assert.equal(playback.readSharedQuality(storage),'original');
  playback.saveSharedQuality('high',storage);assert.equal(playback.readSharedQuality(storage),'high');
  playback.saveSharedQuality('smooth',storage);assert.equal(playback.readSharedQuality(storage),'smooth');
  for(const key of values.keys())values.set(key,'broken');assert.equal(playback.readSharedQuality(storage),'original');
  const blocked={getItem(){throw new Error('storage blocked');},setItem(){throw new Error('storage blocked');}};
  assert.equal(playback.readSharedQuality(blocked),'original');assert.doesNotThrow(()=>playback.saveSharedQuality('original',blocked));
});

test('private and shared playback URLs separate quality renditions and keep version parameters',()=>{
  assert.equal(defaultPlayback.videoQuality,'original');
  assert.equal(playbackURL('/api/media/photo/video?v=3','high'),'/api/media/photo/video?v=3&quality=high');
  assert.equal(playbackURL('/api/shared/share/media/photo/video?v=4','original'),'/api/shared/share/media/photo/video?v=4&quality=original');
  assert.equal(playbackURL('/api/media/photo/video','smooth'),'/api/media/photo/video?quality=smooth');
});

test('live playback starts with sound on and respects the muted preference',async()=>{
  const observed=[],video={muted:false,async play(){observed.push(this.muted);}};
  assert.equal(await playLive(video,true),'playing');
  assert.equal(await playLive(video,false),'playing');
  assert.deepEqual(observed,[false,true]);
});
test('browser sound blocking falls back to muted autoplay without changing the saved preference',async()=>{
  const observed=[],video={muted:false,async play(){observed.push(this.muted);if(!this.muted)throw Object.assign(new Error('Blocked'),{name:'NotAllowedError'});}};
  assert.equal(await playLive(video,true),'muted');assert.deepEqual(observed,[false,true]);
});
test('cancelled playback does not retry or change another photo; media errors are not disguised as browser blocking',async()=>{
  let release,calls=0;
  const video={muted:false,play(){calls++;return new Promise((_,reject)=>{release=reject;});}};
  let active=true;const pending=playLive(video,true,()=>active);active=false;
  release(Object.assign(new Error('Blocked'),{name:'NotAllowedError'}));
  assert.equal(await pending,'cancelled');assert.equal(calls,1);assert.equal(video.muted,false);
  await assert.rejects(playLive({muted:false,async play(){throw Object.assign(new Error('Unreadable'),{name:'NotSupportedError'});}},true),/Unreadable/);
});

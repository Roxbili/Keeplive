import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {Writable} from 'node:stream';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout} from 'node:timers/promises';
import {bundle} from '../server/media.js';

test('a full cache disk closes every ZIP source stream and file descriptor',async t=>{
  const base=await mkdtemp(path.join(tmpdir(),'keeplive-zip-cleanup-')),input=path.join(base,'movie.mov');await writeFile(input,Buffer.alloc(2*1024*1024,7));
  const readers=[],read=fs.createReadStream;let written=0;
  t.mock.method(fs,'createReadStream',(...args)=>{const stream=read(...args);readers.push(stream);return stream;});
  t.mock.method(fs,'createWriteStream',()=>new Writable({write(chunk,encoding,callback){written+=chunk.length;callback(written>65536?Object.assign(new Error('cache full'),{code:'ENOSPC'}):null);}}));syncBuiltinESMExports();
  try{
    await assert.rejects(bundle([{path:input,name:'movie.mov'}],path.join(base,'package.zip')),error=>error.code==='ENOSPC');
    assert.ok(readers.length>0);await setTimeout(50);assert.ok(readers.every(stream=>stream.destroyed&&stream.closed),'ZIP failure must release original file handles');
  }finally{for(const stream of readers)stream.destroy();t.mock.restoreAll();syncBuiltinESMExports();await rm(base,{recursive:true,force:true});}
});

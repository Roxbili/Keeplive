import test from 'node:test';
import assert from 'node:assert/strict';
import { NativeDirectoryPicker } from '../server/native-directory.js';

test('native process carries paths as data, maps Cancel, and recovers after process failure',async()=>{
  const initial="C:\\照片\\单引号' $() ; 文件夹";let answer={path:initial,canceled:false};
  const picker=new NativeDirectoryPicker({supported:true,async run(_command,_args,options){assert.equal(options.env.KEEPLIVE_PICKER_INITIAL,initial);if(answer instanceof Error)throw answer;return{stdout:JSON.stringify(answer)};}});
  assert.equal(await picker.pick(initial),initial);answer={path:null,canceled:true};assert.equal(await picker.pick(initial),null);
  answer=Error('process failed');await assert.rejects(picker.pick(initial),error=>error.status===409);
  answer={path:initial,canceled:false};assert.equal(await picker.pick(initial),initial);await picker.close();
  await assert.rejects(picker.pick(initial),error=>error.status===409);
});
test('one native window at a time; caller disconnect and shutdown abort the running process',async()=>{
  let started;const ready=()=>new Promise(resolve=>started=resolve);
  const picker=new NativeDirectoryPicker({supported:true,run:async(_command,_args,{signal})=>{started();return new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});}});
  const controller=new AbortController();let opened=ready(),pending=picker.pick('',{signal:controller.signal});await opened;
  await assert.rejects(picker.pick(),error=>error.status===409);controller.abort();await assert.rejects(pending,error=>error.status===409);
  opened=ready();pending=picker.pick();const rejected=assert.rejects(pending,error=>error.status===409);await opened;await picker.close();await rejected;
});

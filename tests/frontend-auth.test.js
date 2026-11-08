import test from 'node:test';
import assert from 'node:assert/strict';
import {api,setApiIdentity} from '../src/api.ts';

async function mockClient(run){
  const originalFetch=globalThis.fetch,originalWindow=globalThis.window,events=[];
  globalThis.window={dispatchEvent:event=>events.push(event.type)};
  try{await run(events);}finally{globalThis.fetch=originalFetch;globalThis.window=originalWindow;setApiIdentity(null);}
}
test('a delayed old 401 cannot log out the same user after password rotation',async()=>mockClient(async events=>{
  setApiIdentity('owner');let release;
  globalThis.fetch=async(url)=>url.endsWith('/status')?new Promise(r=>{release=r;}):new Response('{"ok":true}',{status:200,headers:{'X-Keeplive-User':'owner'}});
  const pending=api('/status');const rejected=assert.rejects(pending,e=>e.name==='AbortError');
  await api('/auth/password','PUT',{currentPassword:'old-password',newPassword:'new-password'});
  release(new Response('{"error":"expired"}',{status:401}));await rejected;assert.deepEqual(events,[]);
}));

test('cross-tab cookie changes request an identity refresh and discard foreign response data',async()=>mockClient(async events=>{
  setApiIdentity('owner');globalThis.fetch=async(_url,input)=>{assert.equal(input.headers['X-Keeplive-Expected'],'owner');return new Response('{"items":["private"]}',{status:200,headers:{'X-Keeplive-User':'member'}});};
  await assert.rejects(api('/photos'),/账号已切换/);assert.deepEqual(events,['keeplive:accountchange']);
}));

test('a status request begun during password rotation cannot expire its newly issued session',async()=>mockClient(async events=>{
  setApiIdentity('owner');let passwordResponse,statusResponse;
  globalThis.fetch=async(url)=>new Promise(r=>{if(url.endsWith('/password'))passwordResponse=r;else statusResponse=r;});
  const changing=api('/auth/password','PUT',{currentPassword:'old-password',newPassword:'new-password'});
  const pending=api('/status'),rejected=assert.rejects(pending,e=>e.name==='AbortError');
  passwordResponse(new Response('{"ok":true}',{status:200,headers:{'X-Keeplive-User':'owner'}}));await changing;
  statusResponse(new Response('{"error":"expired"}',{status:401}));await rejected;assert.deepEqual(events,[]);
}));

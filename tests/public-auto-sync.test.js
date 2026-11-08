import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';
import * as playback from '../src/playback.ts';

const code=transformSync(readFileSync(new URL('../src/PublicShare.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
const photo={id:'a'.repeat(24),filename:'fixture.jpg',kind:'photo',sourceId:'',sourceName:'分享相册',folder:'',takenAt:'2026-01-01T00:00:00.000Z',width:8,height:8,duration:0,favorite:false,available:true,version:'one'};
const page={id:'fixture',total:1,items:[photo],allowDownload:false,expiresAt:null,revision:'one'};
const response=(body,status=200)=>({ok:status>=200&&status<300,status,json:async()=>body});
function harness(){
  const slots=[],timers=new Map(),replies=[],calls=[];let cursor=0,effects=[],tree,dirty=false,timerId=0;
  const Viewer=()=>null,jsx=(type,props)=>({type,props});
  const react={
    useState(initial){const at=cursor++;slots[at]??={value:typeof initial==='function'?initial():initial};return[slots[at].value,next=>{const value=typeof next==='function'?next(slots[at].value):next;if(!Object.is(value,slots[at].value)){slots[at].value=value;dirty=true;}}];},
    useRef(initial){const at=cursor++;return slots[at]??={current:initial};},
    useEffect(fn,deps){const at=cursor++,old=slots[at];if(!old||deps.some((dep,i)=>!Object.is(dep,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[at]={deps,cleanup:fn()};});}}
  };
  const mod={exports:{}};
  vm.runInNewContext(code,{module:mod,exports:mod.exports,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='lucide-react')return{};if(name.includes('playback'))return playback;if(name.includes('Viewer'))return Viewer;throw new Error('Unexpected import '+name);},window:{location:{hash:''},addEventListener(){},removeEventListener(){}},document:{visibilityState:'visible',addEventListener(){},removeEventListener(){}},setInterval(fn){timers.set(++timerId,fn);return timerId;},clearInterval(id){timers.delete(id);},setTimeout,clearTimeout,async fetch(url){calls.push(url);assert.ok(replies.length,'Unexpected fetch '+url);const next=replies.shift();if(next instanceof Error)throw next;return next;}});
  function render(){do{dirty=false;cursor=0;effects=[];tree=mod.exports.default({id:'fixture'});for(const effect of effects)effect();}while(dirty);}
  async function settle(){await new Promise(resolve=>setImmediate(resolve));render();}
  function nodes(value,result=[]){if(Array.isArray(value))value.forEach(child=>nodes(child,result));else if(value&&typeof value==='object'){result.push(value);nodes(value.props?.children,result);}return result;}
  function text(value){if(Array.isArray(value))return value.map(text).join('');if(value&&typeof value==='object')return text(value.props?.children);return typeof value==='string'||typeof value==='number'?String(value):'';}
  const viewerProps=()=>nodes(tree).find(node=>node.type===Viewer)?.props;
  return{timers,calls,replies,viewerProps,async quality(value){nodes(tree).find(node=>node.type==='input'&&node.props.value===value).props.onChange();render();await settle();},async viewerQuality(value){viewerProps().onQualityChange(value);render();await settle();},checkedQuality:()=>nodes(tree).find(node=>node.type==='input'&&node.props.checked)?.props.value,async start(initial=page){replies.push(response(initial));render();await settle();},async poll(next){replies.push(next);assert.equal(timers.size,1);[...timers.values()][0]();await settle();},async openPhoto(){nodes(tree).find(node=>node.props?.['aria-label']==='查看 fixture.jpg').props.onClick();render();await settle();},gallery:()=>nodes(tree).some(node=>node.props?.className==='photo-grid'),viewer:()=>nodes(tree).some(node=>node.type===Viewer),text:()=>text(tree)};
}
test('shared gallery retains data and retries after a temporary outage, including unchanged revision recovery',async()=>{
  const h=harness();await h.start();await h.openPhoto();const original=[...h.timers.keys()];
  await h.poll(new Error('temporary outage'));assert.ok(h.gallery(),'Retain visible photos');assert.ok(h.viewer(),'Retain buffered viewer');assert.deepEqual([...h.timers.keys()],original);assert.match(h.text(),/分享相册暂时离线/);
  await h.poll(response(page));assert.ok(h.gallery());assert.ok(h.viewer());assert.doesNotMatch(h.text(),/分享相册暂时离线/);assert.deepEqual([...h.timers.keys()],original);
});
test('terminal share revocation closes the gallery and viewer and stops unauthorized polling',async()=>{
  const h=harness();await h.start();await h.openPhoto();assert.ok(h.viewer());await h.poll(response({error:'分享已到期或已取消'},410));assert.equal(h.gallery(),false);assert.equal(h.viewer(),false);assert.match(h.text(),/分享已到期或已取消/);assert.equal(h.timers.size,0);
});

test('guest quality controls update viewer playback in both directions without login, including after polling',async()=>{
  const h=harness(),live={...page,items:[{...photo,kind:'live'}]};await h.start(live);await h.openPhoto();
  assert.equal(h.viewerProps().playback.videoQuality,'original');assert.equal(h.viewerProps().readOnly,true);
  await h.quality('smooth');assert.equal(h.viewerProps().playback.videoQuality,'smooth');
  await h.poll(response(live));assert.equal(h.viewerProps().playback.videoQuality,'smooth');
  await h.viewerQuality('high');assert.equal(h.checkedQuality(),'high');
  assert.ok(h.calls.every(url=>url.startsWith('/api/shared/')));
});

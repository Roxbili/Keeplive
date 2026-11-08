import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { transformSync } from 'esbuild';

const code=transformSync(readFileSync(new URL('../src/Sources.tsx',import.meta.url),'utf8'),{loader:'tsx',format:'cjs',jsx:'automatic'}).code;
function harness(){
  const slots=[],replies=[],notices=[];let cursor=0,effects=[],tree,dirty=false;
  const DirectoryPicker=()=>null,jsx=(type,props)=>({type,props});
  const react={useState(initial){const at=cursor++;slots[at]??={value:typeof initial==='function'?initial():initial};return[slots[at].value,next=>{const value=typeof next==='function'?next(slots[at].value):next;if(!Object.is(value,slots[at].value)){slots[at].value=value;dirty=true;}}];},useRef(initial){const at=cursor++;return slots[at]??={current:initial};},useEffect(fn,deps){const at=cursor++,old=slots[at];if(!old||deps.some((dep,i)=>!Object.is(dep,old.deps[i]))){effects.push(()=>{old?.cleanup?.();slots[at]={deps,cleanup:fn()};});}}};
  const mod={exports:{}};
  vm.runInNewContext(code,{module:mod,exports:mod.exports,AbortController,require(name){if(name==='react')return react;if(name==='react/jsx-runtime')return{jsx,jsxs:jsx};if(name==='lucide-react')return{};if(name.includes('DirectoryPicker'))return DirectoryPicker;if(name.includes('api'))return{dateText:()=>'',isStaleRequest:error=>error.name==='AbortError',async api(...args){assert.ok(replies.length,'Unexpected request '+args[0]);const next=replies.shift();if(next instanceof Error)throw next;return typeof next==='function'?next(...args):next;}};throw Error(name);},document:{activeElement:null,body:{style:{overflow:''}},querySelectorAll:()=>[]},window:{addEventListener(){},removeEventListener(){}}});
  function render(){do{dirty=false;cursor=0;effects=[];tree=mod.exports.default({user:{role:'admin'},status:{sources:[{id:'fixture',path:'C:\\photos\\existing',name:'相册',count:0,recursive:true}],scan:{running:false}},onRefresh(){},onBack(){},notify:message=>notices.push(message)});for(const effect of effects)effect();}while(dirty);}
  function nodes(value,result=[]){if(Array.isArray(value))value.forEach(child=>nodes(child,result));else if(value&&typeof value==='object'){result.push(value);nodes(value.props?.children,result);}return result;}
  function text(value){if(Array.isArray(value))return value.map(text).join('');if(value&&typeof value==='object')return text(value.props?.children);return typeof value==='string'||typeof value==='number'?String(value):'';}
  const button=label=>nodes(tree).find(node=>node.type==='button'&&(node.props['aria-label']===label||text(node)===label));
  const choice=()=>nodes(tree).find(node=>node.type==='button'&&node.props.className?.includes('source-folder-choice'));
  render();return{replies,notices,async settle(){await new Promise(resolve=>setImmediate(resolve));render();},open(){button('修改 相册').props.onClick();render();},choose(){const pending=choice().props.onClick();render();return pending;},click(label){button(label).props.onClick();render();},path:()=>text(choice()),web:()=>nodes(tree).some(node=>node.type===DirectoryPicker),dialog:()=>nodes(tree).some(node=>node.props?.role==='dialog'),text:()=>text(tree)};
}
test('local native selection fills the path; cancellation retains it without opening the web picker',async()=>{
  const h=harness();h.open();h.replies.push({available:true},{path:'C:\\photos\\new',canceled:false});await h.choose();await h.settle();assert.match(h.path(),/C:\\photos\\new/);assert.equal(h.web(),false);
  h.replies.push({available:true},{path:null,canceled:true});await h.choose();await h.settle();assert.match(h.path(),/C:\\photos\\new/);assert.equal(h.web(),false);
});
test('remote requests use the web picker; an unavailable native window falls back with feedback',async()=>{
  const remote=harness();remote.open();remote.replies.push({available:false});await remote.choose();await remote.settle();assert.equal(remote.web(),true);
  const local=harness();local.open();local.replies.push({available:true},Object.assign(Error('window unavailable'),{status:409}));await local.choose();await local.settle();assert.equal(local.web(),true);assert.equal(local.notices.length,1);
});
test('switching to web selection cancels the native request and ignores its late reply',async()=>{
  const h=harness();h.open();let release,signal;h.replies.push({available:true},(_url,_method,_body,options)=>{signal=options.signal;return new Promise(resolve=>release=resolve);});const pending=h.choose();await h.settle();h.click('使用网页选择');assert.equal(signal.aborted,true);assert.equal(h.web(),true);release({path:'C:\\late',canceled:false});await pending;await h.settle();assert.equal(h.web(),true);
});

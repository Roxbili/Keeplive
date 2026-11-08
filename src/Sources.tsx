import { useState,useEffect,useRef,type FormEvent } from 'react';
import { FolderPlus,HardDrive,RefreshCw,Pencil,Trash2,ArrowLeft,Check,LoaderCircle,FolderOpen } from 'lucide-react';
import { api,isStaleRequest,type Source,type Status,type User,dateText } from './api';
import DirectoryPicker from './DirectoryPicker';

export default function Sources({status,user,onRefresh,onBack,notify}:{status:Status|null;user:User;onRefresh:()=>void;onBack:()=>void;notify:(s:string)=>void}){
  const [editing,setEditing]=useState<Source|null>(null),[open,setOpen]=useState(false),[browsing,setBrowsing]=useState(false),[path,setPath]=useState(''),[recursive,setRecursive]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[removing,setRemoving]=useState<Source|null>(null);
  const [picking,setPicking]=useState(false),[nativeAvailable,setNativeAvailable]=useState(false),choiceGeneration=useRef(0),choiceAbort=useRef<AbortController|null>(null),nativeFailed=useRef(false);
  function cancelChoice(){choiceGeneration.current++;choiceAbort.current?.abort();choiceAbort.current=null;setPicking(false);}
  function useWeb(){cancelChoice();setError('');setBrowsing(true);}
  useEffect(()=>{if(!open)cancelChoice();},[open]);
  useEffect(()=>()=>{choiceGeneration.current++;choiceAbort.current?.abort();},[]);
  async function chooseFolder(){
    if(choiceAbort.current)return;if(nativeFailed.current){useWeb();return;}
    const version=++choiceGeneration.current,controller=new AbortController();choiceAbort.current=controller;setPicking(true);setError('');
    try{
      const capability=await api<{available:boolean}>('/directories/native','GET',undefined,{signal:controller.signal});
      if(version!==choiceGeneration.current)return;setNativeAvailable(capability.available);
      if(!capability.available){setBrowsing(true);return;}
      const result=await api<{path:string|null;canceled:boolean}>('/directories/native','POST',{path},{signal:controller.signal});
      if(version===choiceGeneration.current&&result.path)setPath(result.path);
    }catch(error){
      if(version!==choiceGeneration.current||isStaleRequest(error))return;
      const {status,code}=error as Error&{status?:number;code?:string};
      if((status===400||status===401||status===403)&&code!=='NATIVE_LOCAL_ONLY')setError((error as Error).message);
      else{nativeFailed.current=true;setNativeAvailable(false);setBrowsing(true);notify('系统窗口暂不可用，已切换到网页选择。');}
    }finally{if(version===choiceGeneration.current){choiceAbort.current=null;setPicking(false);}}
  }
  useEffect(()=>{
    if(!open&&!removing)return;
    const before=document.activeElement as HTMLElement,old=document.body.style.overflow;document.body.style.overflow='hidden';
    const fields=()=>Array.from(document.querySelectorAll<HTMLElement>('.dialog input:not(:disabled),.dialog button:not(:disabled)'));
    fields()[0]?.focus();
    function keys(e:KeyboardEvent){if(e.key==='Escape'&&!busy){if(browsing)setBrowsing(false);else{setOpen(false);setRemoving(null);}}if(e.key==='Tab'){const all=fields(),i=all.indexOf(document.activeElement as HTMLElement);if((e.shiftKey&&i===0)||(!e.shiftKey&&i===all.length-1)){e.preventDefault();all[e.shiftKey?all.length-1:0]?.focus();}}}
    window.addEventListener('keydown',keys);return()=>{window.removeEventListener('keydown',keys);document.body.style.overflow=old;before?.focus();};
  },[open,removing,busy,browsing]);
  function edit(source?:Source){setEditing(source||null);setPath(source?.path||'');setBrowsing(false);setRecursive(source?.recursive??true);setError('');setOpen(true);}
  async function save(e:FormEvent){e.preventDefault();setBusy(true);setError('');try{await api(editing?`/sources/${editing.id}`:'/sources',editing?'PATCH':'POST',{path,recursive});setOpen(false);onRefresh();notify(editing?'目录已更新，正在扫描':'目录已添加，正在扫描');}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function remove(){if(!removing)return;setBusy(true);try{await api(`/sources/${removing.id}`,'DELETE');setRemoving(null);onRefresh();notify('目录已移除，原始照片仍保留在硬盘上');}catch(e){notify((e as Error).message);}finally{setBusy(false);}}
  const scanning=status?.scan.running;
  return <section className="settings-page"><button className="text-button" onClick={onBack}><ArrowLeft size={17}/>返回相册</button><div className="page-heading"><div><span className="eyebrow">YOUR OWN SPACE</span><h1>照片来源</h1><p>连接你的照片文件夹，让回忆各归其位。</p></div><button className="primary" onClick={()=>edit()} disabled={scanning}><FolderPlus size={18}/>添加目录</button></div>
    {user.role==='member'&&<div className="grants-note"><strong>你的授权目录</strong>{user.allowedRoots.length?user.allowedRoots.map(root=><code key={root}>{root}</code>):<p>请先联系管理员，为你分配一个照片文件夹。</p>}</div>}
    <div className="source-explainer"><HardDrive size={21}/><div><strong>照片留在原来的地方</strong><p>相册只读取你添加的目录。缩略图和播放副本单独保存，不会修改原始照片。</p></div></div>
    <div className="sources-list">{status?.sources.map(source=><article className="source-card" key={source.id}><div className="source-icon"><FolderOpen size={25}/></div><div className="source-info"><h3>{source.name}<span className={`status-pill ${source.status==='online'?'online':source.status==='offline'?'offline':''}`}>{({online:'已连接',offline:'未连接',partial:'部分读取',scanning:'扫描中',pending:'待扫描'} as Record<string,string>)[source.status]}</span></h3><code>{source.path}</code><div className="source-meta">{source.count.toLocaleString()} 项 · {source.recursive?'包含子文件夹':'仅此文件夹'}{source.lastScan&&` · 最近扫描 ${dateText(source.lastScan,{month:'numeric',day:'numeric'})}`}</div>{source.error&&<p className="source-error">{source.error}</p>}</div><div className="source-actions"><button className="icon-button" aria-label={`修改 ${source.name}`} onClick={()=>edit(source)} disabled={scanning}><Pencil size={17}/></button><button className="icon-button" aria-label={`移除 ${source.name}`} onClick={()=>setRemoving(source)} disabled={scanning}><Trash2 size={17}/></button></div></article>)}
      {!status?.sources.length&&<div className="empty-source"><FolderPlus size={30}/><h3>还没有照片目录</h3><p>添加电脑或移动硬盘中的照片文件夹，即可开始浏览。</p><button className="secondary" onClick={()=>edit()}>添加第一个目录</button></div>}
    </div>
    <div className="settings-foot"><div><strong>自动同步已开启</strong><p>新增、修改或删除照片后会自动同步。重新连接硬盘后也会自动检查，无需刷新页面。</p></div><button className="secondary" disabled={scanning} onClick={async()=>{try{await api('/scan','POST',{});onRefresh();}catch(e){notify((e as Error).message);}}}><RefreshCw size={16} className={scanning?'spin':''}/>{scanning?'正在同步':'立即检查'}</button></div>
    {open&&<div className="modal-backdrop"><section className={`dialog ${browsing?'directory-dialog':''}`} role="dialog" aria-modal="true" aria-labelledby="source-dialog-title"><h2 id="source-dialog-title">{browsing?'选择照片文件夹':editing?'修改照片目录':'添加照片目录'}</h2>{browsing?<DirectoryPicker initialPath={path} onChoose={selected=>{setPath(selected);setBrowsing(false);setError('');}} onCancel={()=>setBrowsing(false)}/>:<><p>选择照片所在的文件夹，名称会自动使用文件夹名。</p><form onSubmit={save}><div className="source-folder-field"><span>照片文件夹</span><button type="button" className={`source-folder-choice ${path?'selected':''}`} disabled={busy||picking} aria-busy={picking} onClick={()=>void chooseFolder()}>{picking?<LoaderCircle size={23} className="spin"/>:<FolderOpen size={23}/>}<span>{picking?<strong>正在打开文件夹选择…</strong>:path?<><strong>{path.split(/[\\/]/).filter(Boolean).pop()||path}</strong><code>{path}</code></>:<strong>点击选择文件夹</strong>}</span><span className="source-folder-action">{picking?'等待选择':path?'更换':'选择'}</span></button><small role={picking?'status':undefined}>{picking?'请在系统窗口中选择文件夹，或改用网页选择。':'移动硬盘盘符变化时，重新选择文件夹即可。'}</small>{(nativeAvailable||picking)&&<button type="button" className="text-button" disabled={busy} onClick={useWeb}>使用网页选择</button>}</div><label className="checkbox-label"><input type="checkbox" checked={recursive} onChange={e=>setRecursive(e.target.checked)} disabled={busy||picking}/><span>同时扫描子文件夹</span></label>{error&&<p className="form-error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="secondary" disabled={busy} onClick={()=>setOpen(false)}>取消</button><button className="primary" disabled={busy||picking||!path}>{busy?<LoaderCircle size={16} className="spin"/>:<Check size={16}/>}保存并扫描</button></div></form></>}</section></div>}
    {removing&&<div className="modal-backdrop"><section className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="remove-title"><h2 id="remove-title">移除「{removing.name}」？</h2><p>将从相册移除这个来源的记录和收藏。硬盘上的原始照片不会删除。</p><div className="dialog-actions"><button className="secondary" onClick={()=>setRemoving(null)} disabled={busy}>取消</button><button className="danger" onClick={remove} disabled={busy}>移除目录</button></div></section></div>}
  </section>;
}

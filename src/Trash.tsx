import {useCallback,useEffect,useRef,useState} from 'react';
import {ArrowLeft,Trash2,RotateCcw,LoaderCircle} from 'lucide-react';
import {api,isStaleRequest} from './api';
interface TrashItem {id:string;filename:string;kind:string;sourceName:string;deletedAt:string;interrupted:boolean;available:boolean}
export default function Trash({onBack,onRestored}:{onBack:()=>void;onRestored:()=>void}){
  const [items,setItems]=useState<TrashItem[]>([]),[loading,setLoading]=useState(true),[busy,setBusy]=useState(''),[error,setError]=useState('');const active=useRef(true);
  const load=useCallback(async()=>{try{const data=await api<{items:TrashItem[]}>('/trash');if(active.current){setItems(data.items);setError('');}}catch(error){if(active.current&&!isStaleRequest(error))setError((error as Error).message);}finally{if(active.current)setLoading(false);}},[]);
  useEffect(()=>{active.current=true;void load();return()=>{active.current=false;};},[load]);
  async function restore(item:TrashItem){setBusy(item.id);setError('');try{await api('/trash/'+item.id+'/restore','POST',{});if(!active.current)return;setItems(old=>old.filter(row=>row.id!==item.id));onRestored();}catch(error){if(active.current&&!isStaleRequest(error))setError((error as Error).message);}finally{if(active.current)setBusy('');}}
  return <section className="settings-page"><button className="text-button" onClick={onBack}><ArrowLeft size={17}/>返回设置</button><div className="page-heading"><div><span className="eyebrow">ROOM TO CHANGE YOUR MIND</span><h1>回收站</h1><p>误删的影像，可以回到原来的位置。</p></div></div>
    <div className="source-explainer"><Trash2 size={22}/><div><strong>原文件留在照片所在的硬盘</strong><p>恢复需要硬盘在线。回收目录仍占用磁盘空间，不会自动清空；恢复不会覆盖同名文件，也不会重新加入旧分享。</p></div></div>
    {error&&<p className="form-error" role="alert">{error}<button className="text-button" onClick={()=>void load()}>重新加载</button></p>}
    {loading?<div className="empty-state"><LoaderCircle className="spin" size={25}/></div>:items.length?<div className="trash-list">{items.map(item=><article className="trash-card" key={item.id}><span className="source-icon"><Trash2 size={22}/></span><div className="trash-copy"><h2>{item.filename}</h2><p>{item.sourceName} · {new Date(item.deletedAt).toLocaleString('zh-CN')}</p>{item.kind==='live'&&<small>实况照片 · 包含静态图和视频</small>}{item.interrupted&&<small>上次操作未完成，恢复可找回已移动的部分</small>}{!item.available&&<small>请连接硬盘或重新定位原照片来源</small>}</div><button className="secondary" disabled={!!busy||!item.available} onClick={()=>void restore(item)}>{busy===item.id?<LoaderCircle size={16} className="spin"/>:<RotateCcw size={16}/>}恢复</button></article>)}</div>:!error&&<div className="empty-state"><Trash2 size={30}/><h2>回收站是空的</h2><p>移除的照片会出现在这里。</p></div>}
  </section>;
}

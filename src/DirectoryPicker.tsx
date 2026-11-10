import { useEffect,useState } from 'react';
import { ArrowUp,Check,ChevronRight,Folder,HardDrive,LoaderCircle,RefreshCw } from 'lucide-react';
import { api,isStaleRequest } from './api';

interface DirectoryListing {path:string|null;parent:string|null;selectable:boolean;directories:{name:string;path:string}[]}

export default function DirectoryPicker({initialPath,onChoose,onCancel}:{initialPath:string;onChoose:(path:string)=>void;onCancel:()=>void}){
  const [current,setCurrent]=useState<string|null>(initialPath||null),[listing,setListing]=useState<DirectoryListing|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[attempt,setAttempt]=useState(0);
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    api<DirectoryListing>('/directories'+(current?'?path='+encodeURIComponent(current):''))
      .then(data=>{if(active)setListing(data);})
      .catch(error=>{if(active&&!isStaleRequest(error))setError((error as Error).message);})
      .finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[current,attempt]);
  function navigate(next:string|null){setLoading(true);setCurrent(next);setAttempt(n=>n+1);}
  return <>
    <p>选择家中电脑或移动硬盘里的照片文件夹。</p>
    <div className="directory-navigation"><button type="button" className="text-button" disabled={loading} onClick={()=>navigate(null)}><HardDrive size={17}/>所有位置</button><button type="button" className="text-button" disabled={loading||!listing?.parent||!!error} onClick={()=>navigate(listing!.parent)}><ArrowUp size={17}/>上一级</button></div>
    <div className="directory-location"><span>当前位置</span><code>{!loading&&!error&&listing?(listing.path||'电脑与授权文件夹'):(current||'电脑与授权文件夹')}</code></div>
    <div className="directory-list" aria-label="可选择的文件夹" aria-busy={loading}>
      {loading?<div className="directory-empty" role="status"><LoaderCircle size={22} className="spin"/>正在读取文件夹…</div>:error?<div className="directory-empty"><p className="form-error" role="alert">{error}</p><button type="button" className="text-button" onClick={()=>navigate(current)}><RefreshCw size={16}/>重试</button></div>:listing?.directories.length?listing.directories.map(directory=><button type="button" className="directory-row" key={directory.path} onClick={()=>navigate(directory.path)}><Folder size={21}/><span>{directory.name}</span><ChevronRight size={17}/></button>):<div className="directory-empty">{listing?.path?'这里没有子文件夹，可以选择当前文件夹。':'暂无可用位置，请连接硬盘或联系管理员分配目录。'}</div>}
    </div>
    {!loading&&!error&&listing?.path&&!listing.selectable&&<p className="directory-hint">请继续打开子文件夹，选择你的照片目录。</p>}
    <div className="dialog-actions"><button type="button" className="secondary" onClick={onCancel}>返回</button><button type="button" className="primary" disabled={loading||!!error||!listing?.selectable} onClick={()=>listing?.path&&onChoose(listing.path)}><Check size={16}/>选择这个文件夹</button></div>
  </>;
}

import {useState} from 'react';
import {Trash2,LoaderCircle} from 'lucide-react';
import {api} from './api';
import {useDialog} from './useDialog';
export interface DeleteResult {moved:string[];removed?:string[];failures:{id:string;error:string}[]}
export default function DeleteDialog({ids,filename,onClose,onDeleted}:{ids:string[];filename?:string;onClose:()=>void;onDeleted:(result:DeleteResult)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),root=useDialog(true,onClose,busy);
  async function remove(){setBusy(true);setError('');try{onDeleted(await api<DeleteResult>('/photos/trash','POST',{ids}));}catch(error){setError((error as Error).message);}finally{setBusy(false);}}
  return <div className="modal-backdrop"><section ref={root} className="dialog delete-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-title">
    <span className="delete-dialog-icon"><Trash2 size={25}/></span><h2 id="delete-title">移到回收站？</h2>
    <p>{filename?`「${filename}」`: `选中的 ${ids.length.toLocaleString()} 项影像`}将从相册和分享中移除。原文件移到同一硬盘的回收目录，可在「设置 → 回收站」恢复。</p>
    <p className="delete-detail">实况照片的静态图和视频一起移动。恢复后，旧分享不会自动重新包含这些照片。</p>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {ids.length>1000&&<p className="form-error" role="alert">每次最多删除 1000 项，请减少选择。</p>}
    <div className="dialog-actions"><button className="secondary" disabled={busy} onClick={onClose}>取消</button><button className="danger-button" disabled={busy||ids.length>1000} onClick={()=>void remove()}>{busy?<LoaderCircle size={16} className="spin"/>:<Trash2 size={16}/>}移到回收站</button></div>
  </section></div>;
}

import { useEffect,useRef,useState } from 'react';
import { Aperture,CloudOff,LoaderCircle,Radio,Play,RefreshCw } from 'lucide-react';
import type { Photo } from './api';
import { defaultPlayback,qualityOptions,readSharedQuality,saveSharedQuality,type VideoQuality } from './playback';
import Viewer from './Viewer';

interface SharedPage {id:string;total:number;items:Photo[];allowDownload:boolean;expiresAt:string|null;revision:string}
async function request<T>(url:string,body?:unknown):Promise<T>{
  let response:Response;try{response=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});}catch{throw new Error('分享相册暂时离线，请稍后重试');}
  const data=await response.json().catch(()=>({error:'分享相册暂时离线，请稍后重试'}));if(!response.ok||data.error)throw Object.assign(new Error(data.error||'分享暂时不可访问'),{status:response.ok?502:response.status});return data;
}
function retryable(error:unknown){const status=(error as Error&{status?:number}).status;return !status||status===429||status>=500;}
export default function PublicShare({id}:{id:string}){
  const [quality,setQuality]=useState<VideoQuality>(()=>readSharedQuality());
  function changeQuality(value:VideoQuality){setQuality(value);saveSharedQuality(value);}
  const [data,setData]=useState<SharedPage|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[selected,setSelected]=useState<number|null>(null),[loadingMore,setLoadingMore]=useState(false),[retry,setRetry]=useState(0),[recovering,setRecovering]=useState(false);const generation=useRef(0),dataRef=useRef(data),selectedRef=useRef(selected),moreRunning=useRef(false),refreshing=useRef<Promise<void>|null>(null);dataRef.current=data;selectedRef.current=selected;
  const base='/api/shared/'+encodeURIComponent(id),getMediaURL=(photo:Photo,variant:string)=>`${base}/media/${photo.id}/${variant}?v=${photo.version}`;
  useEffect(()=>{const changed=()=>setRetry(value=>value+1);window.addEventListener('hashchange',changed);return()=>window.removeEventListener('hashchange',changed);},[]);
  useEffect(()=>{
    const version=++generation.current;setLoading(true);setError('');setData(null);setSelected(null);setLoadingMore(false);moreRunning.current=false;
    async function load(){try{
      const token=window.location.hash.slice(1);if(token)await request(base+'/access',{token});
      const next=await request<SharedPage>(base);if(version===generation.current){setData(next);setRecovering(false);}
    }catch(error){if(version===generation.current){setError((error as Error).message);setRecovering(retryable(error));}}finally{if(version===generation.current)setLoading(false);}}
    void load();return()=>{generation.current++;};
  },[id,retry]);
  useEffect(()=>{if(!recovering||data||loading)return;const timer=setTimeout(()=>setRetry(n=>n+1),5000);return()=>clearTimeout(timer);},[recovering,data,loading,retry]);
  useEffect(()=>{
    if(!data)return;let active=true;const version=generation.current;
    async function check(){try{
      const previous=dataRef.current;if(!previous)return;
      const current=await request<SharedPage>(base+'?limit=1');if(!active||version!==generation.current)return;
      if(current.revision===previous.revision){setError('');setData(old=>old?{...old,allowDownload:current.allowDownload,expiresAt:current.expiresAt}:old);return;}
      const items:Photo[]=[],count=Math.max(90,previous.items.length);let latest=current,snapshot:string|undefined,consistent=true;
      for(let offset=0;offset<count;offset+=150){latest=await request<SharedPage>(base+'?offset='+offset+'&limit='+Math.min(150,count-offset));if(snapshot!==undefined&&snapshot!==latest.revision)consistent=false;snapshot??=latest.revision;items.push(...latest.items);if(items.length>=latest.total)break;}
      if(!active||version!==generation.current)return;
      const unique=[...new Map(items.map(photo=>[photo.id,photo])).values()],index=selectedRef.current,photoId=index===null?null:dataRef.current?.items[index]?.id;dataRef.current={...latest,revision:consistent?latest.revision:'',items:unique};setData(dataRef.current);setError('');setSelected(photoId?unique.findIndex(photo=>photo.id===photoId)>=0?unique.findIndex(photo=>photo.id===photoId):null:null);
    }catch(error){if(active&&version===generation.current){if(!retryable(error)){setData(null);setSelected(null);}setError((error as Error).message);}}}
    function update(){if(document.visibilityState==='hidden'||moreRunning.current||refreshing.current)return;const pending=check().finally(()=>{if(refreshing.current===pending)refreshing.current=null;});refreshing.current=pending;}
    const visible=()=>{if(document.visibilityState==='visible')update();};const timer=setInterval(update,5000);window.addEventListener('focus',update);document.addEventListener('visibilitychange',visible);return()=>{active=false;clearInterval(timer);window.removeEventListener('focus',update);document.removeEventListener('visibilitychange',visible);};
  },[id,!!data,retry]);
  async function more(){if(!dataRef.current||moreRunning.current)return;const version=generation.current;moreRunning.current=true;setLoadingMore(true);try{if(refreshing.current)await refreshing.current;if(version!==generation.current||!dataRef.current)return;const previous=dataRef.current,next=await request<SharedPage>(base+'?offset='+previous.items.length);if(version===generation.current){dataRef.current={...next,revision:next.revision===previous.revision?next.revision:'',items:[...new Map([...previous.items,...next.items].map(photo=>[photo.id,photo])).values()]};setData(dataRef.current);setError('');}}catch(error){if(version===generation.current){if(!retryable(error)){setData(null);setSelected(null);}setError((error as Error).message);}}finally{if(version===generation.current){moreRunning.current=false;setLoadingMore(false);}}}
  return <div className="public-share"><header className="public-share-header"><a className="brand" href="/" aria-label="Keeplive 首页"><span className="brand-mark"><Aperture size={21}/></span>Keeplive</a><span>一起留住这一刻</span></header><main className="public-share-content">{loading?<div className="connection-page"><LoaderCircle size={26} className="spin"/><p>正在打开分享相册…</p></div>:error&&!data?<div className="empty-state"><CloudOff size={34}/><h2>分享暂时无法查看</h2><p>{error}</p><button className="secondary" onClick={()=>setRetry(n=>n+1)}><RefreshCw size={16}/>重新查看</button></div>:data?<><div className="page-heading"><div><span className="eyebrow">MEMORIES TOGETHER</span><h1>分享给你的瞬间<span className="heading-point">.</span></h1><p>无需登录，轻点照片即可查看。{data.allowDownload?'可下载原文件。':'原文件下载未开启。'}</p></div><div className="heading-count"><strong>{data.total.toLocaleString()}</strong><span>段影像记忆</span></div></div>{error&&<div className="notice" role="status">{error}。连接恢复后会自动继续同步。</div>}{data.items.some(photo=>!photo.available)&&<div className="notice">部分照片所在的硬盘暂未连接，请稍后再查看。</div>}{data.items.some(photo=>photo.kind!=='photo')&&<fieldset className="shared-quality" aria-describedby="shared-quality-hint"><legend>播放清晰度</legend><p id="shared-quality-hint">用于实况和视频，按当前网络自由切换。</p><div className="shared-quality-options">{qualityOptions.map(option=><label key={option.value} className={`shared-quality-option ${quality===option.value?'selected':''}`}><input type="radio" name="shared-quality" value={option.value} checked={quality===option.value} onChange={()=>changeQuality(option.value)}/><span>{option.label}</span></label>)}</div></fieldset>}{data.items.length?<div className="photo-grid">{data.items.map((photo,index)=><article className="photo-card" key={photo.id}><button className="photo-open" aria-label={`查看 ${photo.filename}`} onClick={()=>setSelected(index)}><img src={getMediaURL(photo,'thumb')} alt={photo.filename} loading="lazy"/>{photo.kind!=='photo'&&<span className="media-badge">{photo.kind==='live'?<Radio size={12}/>:<Play size={12}/>}<span>{photo.kind==='live'?'LIVE':'视频'}</span></span>}<span className="photo-caption">{photo.filename}</span></button></article>)}</div>:<div className="empty-source"><h3>分享中的照片已移除</h3><p>请联系分享者确认照片是否仍可用。</p></div>}{data.items.length<data.total&&<button className="secondary load-more" disabled={loadingMore} onClick={()=>void more()}>{loadingMore&&<LoaderCircle size={16} className="spin"/>}加载更多照片</button>}<p className="public-share-foot">原始影像保留在分享者的设备上。</p></>:null}</main>{data&&selected!==null&&data.items[selected]&&<Viewer photos={data.items} index={selected} playback={{...defaultPlayback,videoQuality:quality}} onQualityChange={changeQuality} onIndex={setSelected} onClose={()=>setSelected(null)} onFavorite={()=>{}} readOnly allowDownloads={data.allowDownload} getMediaURL={getMediaURL}/>}</div>;
}

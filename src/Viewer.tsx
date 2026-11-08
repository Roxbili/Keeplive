import { useEffect,useRef,useState } from 'react';
import { X,ChevronLeft,ChevronRight,Download,Play,Pause,Volume2,VolumeX,Info,Radio,LoaderCircle,Trash2 } from 'lucide-react';
import { type Photo,mediaURL,dateText } from './api';
import { playLive,playbackURL,qualityOptions,type VideoQuality,type PlaybackPreferences } from './playback';
import FavoriteHeart from './FavoriteHeart';

export default function Viewer({photos,index,playback,onIndex,onClose,onFavorite,onDelete,onQualityChange,readOnly=false,allowDownloads=true,getMediaURL=mediaURL}:{photos:Photo[];index:number;playback:PlaybackPreferences;onIndex:(n:number)=>void;onClose:()=>void;onFavorite:(p:Photo)=>void;onDelete?:(p:Photo)=>void;onQualityChange?:(quality:VideoQuality)=>void;readOnly?:boolean;allowDownloads?:boolean;getMediaURL?:(photo:Photo,variant:string)=>string}){
  const photo=photos[index],video=useRef<HTMLVideoElement>(null),closeButton=useRef<HTMLButtonElement>(null),touch=useRef<{x:number;y:number}|null>(null);
  const soundEnabled=photo.kind==='live'?playback.liveSound:playback.videoSound;
  const quality=playback.videoQuality;
  const [playing,setPlaying]=useState(false),[muted,setMuted]=useState(!soundEnabled),[info,setInfo]=useState(false),[error,setError]=useState(''),[hint,setHint]=useState(''),[loading,setLoading]=useState(true);
  const dynamic=photo.kind==='live'||photo.kind==='video';
  useEffect(()=>{
    let cancelled=false;
    setPlaying(false);setError('');setHint('');setLoading(true);setMuted(!soundEnabled);
    const current=video.current;
    if(current)current.muted=!soundEnabled;
    if(photo.kind==='live'&&current){
      setPlaying(true);
      const isCurrent=()=>!cancelled&&video.current===current;
      void playLive(current,soundEnabled,isCurrent).then(result=>{
        if(!isCurrent()||result==='cancelled')return;
        if(result==='muted'){setMuted(true);setHint('浏览器暂未允许有声自动播放，点击声音按钮开启。');}
      }).catch((error:Error)=>{
        if(cancelled||video.current!==current)return;
        setPlaying(false);setLoading(false);
        if(error.name==='NotAllowedError')setError('点击「播放实况」开始播放');
        else if(error.name!=='AbortError')setError('暂时无法播放，请检查硬盘连接后重试');
      });
    }
    return()=>{cancelled=true;};
  },[photo.id,photo.kind,soundEnabled,quality]);
  useEffect(()=>{const current=video.current;return()=>{current?.pause();if(current&&!current.isConnected){current.removeAttribute('src');current.load();}};},[photo.id,quality]);
  useEffect(()=>{
    const before=document.activeElement as HTMLElement;closeButton.current?.focus();const scroll=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=scroll;before?.focus();};
  },[]);
  useEffect(()=>{
    function keys(e:KeyboardEvent){
      const editing=e.target instanceof HTMLElement&&!!e.target.closest('select,input,textarea,[contenteditable="true"]');
      if(e.key==='Escape')onClose();if(!editing&&e.key==='ArrowLeft'&&index>0)onIndex(index-1);if(!editing&&e.key==='ArrowRight'&&index<photos.length-1)onIndex(index+1);
      if(e.key==='Tab'){const buttons=Array.from(document.querySelectorAll<HTMLElement>('.viewer button:not(:disabled),.viewer a[href],.viewer select'));const i=buttons.indexOf(document.activeElement as HTMLElement);if((e.shiftKey&&i===0)||(!e.shiftKey&&i===buttons.length-1)){e.preventDefault();buttons[e.shiftKey?buttons.length-1:0]?.focus();}}
    }
    window.addEventListener('keydown',keys);return()=>window.removeEventListener('keydown',keys);
  },[index,photos.length,onClose,onIndex]);
  async function toggle(){
    const current=video.current;if(!current)return;
    if(playing){current.pause();setPlaying(false);}else{setError('');setPlaying(true);current.muted=muted;try{await current.play();}catch{if(video.current===current){setPlaying(false);setError('暂时无法播放，请检查硬盘连接后重试');}}}
  }
  async function toggleSound(){const current=video.current;if(!current)return;const next=!muted;current.muted=next;setMuted(next);setHint('');if(playing){try{await current.play();}catch{if(video.current===current){setPlaying(false);setError('点击播放按钮继续观看');}}}}
  return <div className="viewer" role="dialog" aria-modal="true" aria-label={`查看 ${photo.filename}`}>

    <header className="viewer-top"><div className="viewer-title"><strong>{dateText(photo.takenAt)}</strong><span>{index+1} / {photos.length}{dynamic&&<><i/> {photo.kind==='live'?'LIVE PHOTO':'VIDEO'}</>}</span></div><div className="viewer-actions">{!readOnly&&onDelete&&<button className="icon-button viewer-delete" aria-label="删除照片" onClick={()=>{video.current?.pause();onDelete(photo);}}><Trash2 size={19}/></button>}{!readOnly&&<button className={`icon-button ${photo.favorite?'favorited':''}`} aria-label={photo.favorite?'取消收藏':'收藏照片'} onClick={()=>onFavorite(photo)}><FavoriteHeart key={photo.id} size={20} favorite={photo.favorite}/></button>}{allowDownloads&&<a className="icon-button" href={getMediaURL(photo,'download')} aria-label={photo.kind==='live'?'下载实况照片':'下载原文件'} title={photo.kind==='live'?'下载实况照片（图片和视频）':'下载原文件'}><Download size={20}/></a>}<button className="icon-button" aria-label="照片信息" aria-pressed={info} onClick={()=>setInfo(!info)}><Info size={20}/></button><button ref={closeButton} className="icon-button" aria-label="关闭大图" onClick={onClose}><X size={23}/></button></div></header>
    <div className="viewer-stage" onTouchStart={e=>{touch.current={x:e.touches[0].clientX,y:e.touches[0].clientY};}} onTouchEnd={e=>{if(!touch.current)return;const dx=e.changedTouches[0].clientX-touch.current.x,dy=e.changedTouches[0].clientY-touch.current.y;touch.current=null;if(Math.abs(dx)>65&&Math.abs(dx)>Math.abs(dy)*1.5){if(dx<0&&index<photos.length-1)onIndex(index+1);if(dx>0&&index>0)onIndex(index-1);}}}>
      <button className="viewer-arrow arrow-left" aria-label="上一张" disabled={index===0} onClick={()=>onIndex(index-1)}><ChevronLeft size={28}/></button>
      <div className="viewer-picture" key={`${photo.id}:${quality}`}>
        <img src={getMediaURL(photo,'preview')} alt={photo.filename} onLoad={()=>setLoading(false)} onError={()=>{setLoading(false);setError(readOnly?'照片暂时不可读取，请稍后重试':'预览暂时不可用，请检查照片目录');}} style={{opacity:playing?0:1}}/>
        {dynamic&&<video ref={video} src={playbackURL(getMediaURL(photo,'video'),quality)} playsInline muted={muted} preload={photo.kind==='live'?'auto':'none'} onWaiting={()=>setLoading(true)} onCanPlay={()=>setLoading(false)} onPlaying={()=>{setPlaying(true);setLoading(false);}} onPause={()=>setPlaying(false)} onEnded={()=>{setPlaying(false);if(video.current)video.current.currentTime=0;}} onError={()=>{setLoading(false);setPlaying(false);setError(readOnly?'视频暂时不可播放，请稍后重试':'视频无法读取或转换，请检查文件后重试');}} style={{opacity:playing?1:0,pointerEvents:'none'}}/>}
        {loading&&<div className="viewer-loading"><LoaderCircle size={28} className="spin"/><span>{playing?'正在准备播放…':'正在加载照片…'}</span></div>}
      </div>
      <button className="viewer-arrow arrow-right" aria-label="下一张" disabled={index===photos.length-1} onClick={()=>onIndex(index+1)}><ChevronRight size={28}/></button>
    </div>
    {error&&<div className="viewer-error" role="alert">{error}</div>}
    {hint&&!error&&<div className="viewer-notice" role="status">{hint}</div>}
    {dynamic&&onQualityChange&&<label className="viewer-quality"><span>播放清晰度</span><select aria-label="播放清晰度" value={quality} onChange={event=>onQualityChange(event.target.value as VideoQuality)}>{qualityOptions.map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>}
    <footer className="viewer-bottom"><span>{photo.filename}</span>{dynamic&&<div className="play-controls"><button className="play-button" onClick={toggle}>{playing?<Pause size={17}/>:photo.kind==='live'?<Radio size={17}/>:<Play size={17}/>}<span>{playing?'暂停':photo.kind==='live'?'播放实况':'播放视频'}</span></button><button className="icon-button" aria-label={muted?'打开声音':'静音'} onClick={()=>void toggleSound()}>{muted?<VolumeX size={20}/>:<Volume2 size={20}/>}</button></div>}<span className="viewer-hint">左右滑动切换</span></footer>
    {info&&<aside className="photo-info"><h3>照片信息</h3><dl><dt>文件名</dt><dd>{photo.filename}</dd><dt>拍摄时间</dt><dd>{new Date(photo.takenAt).toLocaleString('zh-CN')}</dd>{!readOnly&&<><dt>来源</dt><dd>{photo.sourceName}</dd><dt>文件夹</dt><dd>{photo.folder||'根目录'}</dd></>}<dt>尺寸</dt><dd>{photo.width} × {photo.height}</dd><dt>类型</dt><dd>{photo.kind==='live'?'实况照片':photo.kind==='video'?'视频':'照片'}</dd></dl></aside>}
  </div>;
}

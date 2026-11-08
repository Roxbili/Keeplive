import { useCallback,useEffect,useRef,useState } from 'react';
import { Aperture,Images,Heart,Radio,FolderOpen,Settings2,Search,RefreshCw,LogOut,Plus,ArrowUpRight,ChevronRight,HardDrive,CloudOff,LoaderCircle,X,Play,Camera,ArrowLeft,Check,UserRound,Users,Link2,CheckSquare,Trash2 } from 'lucide-react';
import { api,setApiIdentity,isStaleRequest,mediaURL,dateText,type Photo,type Status,type Folder,type AuthStatus } from './api';
import AuthScreen from './AuthScreen';
import Settings from './Settings';
import Sources from './Sources';
import Account from './Account';
import Viewer from './Viewer';
import { defaultPlayback,type PlaybackPreferences } from './playback';
import FavoriteHeart from './FavoriteHeart';
import FilterTabs from './FilterTabs';
import ShareDialog from './ShareDialog';
import MyShares from './MyShares';
import Trash from './Trash';
import DeleteDialog,{type DeleteResult} from './DeleteDialog';

type View='timeline'|'albums'|'favorites'|'live'|'settings'|'sources'|'account'|'users'|'shares'|'trash';
const galleryViews:View[]=['timeline','albums','favorites','live'];
const emptyStats={total:0,live:0,videos:0,favorites:0};

function PhotoCard({photo,onOpen,onFavorite,selecting=false,picked=false,selectionBusy=false}:{photo:Photo;onOpen:()=>void;onFavorite:()=>void;selecting?:boolean;picked?:boolean;selectionBusy?:boolean}){
  const [failed,setFailed]=useState(false);
  return <article className={`photo-card ${!photo.available?'unavailable':''} ${picked?'is-picked':''}`}>
    <button className="photo-open" onClick={onOpen} disabled={selecting&&selectionBusy} aria-pressed={selecting?picked:undefined} aria-label={selecting?`${picked?'取消选择':'选择'} ${photo.filename}`:`查看 ${photo.filename}${photo.kind==='live'?'，实况照片':''}`}>
      {failed?<div className="photo-fallback"><Camera size={26}/><span>{photo.available?'预览暂不可用':'连接硬盘后查看'}</span></div>:<img src={mediaURL(photo,'thumb')} alt={photo.filename} loading="lazy" decoding="async" onError={()=>setFailed(true)}/>}
      {photo.kind!=='photo'&&<span className="media-badge">{photo.kind==='live'?<Radio size={12}/>:<Play size={12}/>}<span>{photo.kind==='live'?'LIVE':'视频'}</span></span>}
      {!photo.available&&<span className="offline-badge"><CloudOff size={13}/></span>}
      <span className="photo-caption">{photo.filename}</span>
      {selecting&&<span className={`photo-selection-check ${picked?'checked':''}`}>{picked&&<Check size={15}/>}</span>}
    </button>
    {!selecting&&<button className={`photo-favorite ${photo.favorite?'is-favorite':''}`} onClick={onFavorite} aria-label={photo.favorite?`取消收藏 ${photo.filename}`:`收藏 ${photo.filename}`}><FavoriteHeart size={16} favorite={photo.favorite}/></button>}
  </article>;
}

export default function App(){
  const [deleteTarget,setDeleteTarget]=useState<{ids:string[];filename?:string;returnId?:string}|null>(null);
  const [auth,setAuth]=useState<AuthStatus|null>(null),[authError,setAuthError]=useState('');
  const [view,setView]=useState<View>('timeline'),[status,setStatus]=useState<Status|null>(null),[photos,setPhotos]=useState<Photo[]>([]),[folders,setFolders]=useState<Folder[]>([]),[total,setTotal]=useState(0);
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[kind,setKind]=useState(''),[source,setSource]=useState(''),[folder,setFolder]=useState<string|undefined>(),[selected,setSelected]=useState<number|null>(null);
  const [loading,setLoading]=useState(false),[loadingMore,setLoadingMore]=useState(false),[error,setError]=useState(''),[toast,setToast]=useState(''),[revision,setRevision]=useState(0);
  const generation=useRef(0),indexVersion=useRef<number|null>(null),lastFilter=useRef(''),photosRef=useRef<Photo[]>([]),toastTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const identity=useRef<string|null>(null),errorRef=useRef(error);errorRef.current=error;
  const [selecting,setSelecting]=useState(false),[picked,setPicked]=useState<Set<string>>(()=>new Set()),[selectionBusy,setSelectionBusy]=useState(false),[shareOpen,setShareOpen]=useState(false);const selectionEpoch=useRef(0);
  photosRef.current=photos;
  const notify=useCallback((text:string)=>{setToast(text);if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(''),4500);},[]);
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current);},[]);
  const clearAlbum=useCallback(()=>{generation.current++;selectionEpoch.current++;setDeleteTarget(null);setSelecting(false);setPicked(new Set());setShareOpen(false);setSelectionBusy(false);indexVersion.current=null;lastFilter.current='';photosRef.current=[];setSelected(null);setStatus(null);setPhotos([]);setFolders([]);setTotal(0);setSource('');setFolder(undefined);setSearch('');setQuery('');setKind('');setView('timeline');setError('');setToast('');setLoading(false);setLoadingMore(false);},[]);
  const checkAuth=useCallback(async()=>{try{const next=await api<AuthStatus>('/auth/status');setAuthError('');const id=next.user?.id??null;if(identity.current!==id){identity.current=id;setApiIdentity(id);clearAlbum();}setAuth(next);}catch(e){if(!isStaleRequest(e))setAuthError((e as Error).message);}},[clearAlbum]);
  useEffect(()=>{void checkAuth();const logout=()=>{identity.current=null;setApiIdentity(null);clearAlbum();setAuth({setup:false,setupAllowed:false,authenticated:false,user:null});};const changed=()=>{identity.current=null;setApiIdentity(null);clearAlbum();setAuth(null);void checkAuth();};const visible=()=>{if(document.visibilityState==='visible')void checkAuth();};window.addEventListener('keeplive:logout',logout);window.addEventListener('keeplive:accountchange',changed);window.addEventListener('focus',checkAuth);document.addEventListener('visibilitychange',visible);return()=>{window.removeEventListener('keeplive:logout',logout);window.removeEventListener('keeplive:accountchange',changed);window.removeEventListener('focus',checkAuth);document.removeEventListener('visibilitychange',visible);};},[checkAuth,clearAlbum]);
  useEffect(()=>{if(!authError)return;const timer=setInterval(()=>void checkAuth(),3000);return()=>clearInterval(timer);},[authError,checkAuth]);
  const refresh=useCallback(async()=>{
    const id=identity.current;if(!id)return;
    try{
      const next=await api<Status>('/status');if(identity.current!==id)return;setStatus(next);
      setPhotos(old=>old.map(p=>({...p,available:next.sources.find(s=>s.id===p.sourceId)?.status!=='offline'})));
      if(indexVersion.current!==next.version||errorRef.current){setError('');indexVersion.current=next.version;setRevision(v=>v+1);}
    }catch(e){if(identity.current===id&&!isStaleRequest(e))setError((e as Error).message);}
  },[]);
  useEffect(()=>{if(!auth?.authenticated)return;void refresh();const timer=setInterval(refresh,3000);return()=>clearInterval(timer);},[auth?.user?.id,auth?.authenticated,refresh]);
  useEffect(()=>{const timer=setTimeout(()=>setQuery(search),250);return()=>clearTimeout(timer);},[search]);
  function params(offset=0){const p=new URLSearchParams({offset:String(offset),limit:'90'});if(query)p.set('search',query);if(source)p.set('source',source);if(folder!==undefined)p.set('folder',folder);if(view==='favorites')p.set('favorite','true');if(view==='live'||kind)p.set('kind',view==='live'?'live':kind);return p;}
  useEffect(()=>{selectionEpoch.current++;setPicked(new Set());setShareOpen(false);setSelectionBusy(false);},[view,query,source,folder,kind]);
  useEffect(()=>{
    if(!auth?.authenticated||!selecting)return;let active=true;const id=identity.current,epoch=selectionEpoch.current;
    void api<{ids:string[]}>('/photo-selection?'+params()).then(data=>{if(!active||identity.current!==id||epoch!==selectionEpoch.current)return;const valid=new Set(data.ids);setPicked(old=>{const next=new Set([...old].filter(key=>valid.has(key)));return next.size===old.size?old:next;});}).catch(()=>{});
    return()=>{active=false;};
  },[auth?.user?.id,auth?.authenticated,selecting,status?.version,view,query,source,folder,kind]);
  function pick(id:string){setPicked(old=>{const next=new Set(old);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  async function selectMatching(monthItems?:Photo[]){const id=identity.current,version=selectionEpoch.current;setSelectionBusy(true);try{const filter=params();if(monthItems?.length){const date=new Date(monthItems[0].takenAt);filter.set('from',new Date(date.getFullYear(),date.getMonth(),1).toISOString());filter.set('until',new Date(date.getFullYear(),date.getMonth()+1,1).toISOString());}const data=await api<{ids:string[]}>('/photo-selection?'+filter);if(identity.current!==id||version!==selectionEpoch.current)return;setPicked(old=>{if(!monthItems)return new Set(data.ids);const next=new Set(old),remove=data.ids.every(key=>old.has(key));for(const key of data.ids){if(remove)next.delete(key);else next.add(key);}return next;});}catch(error){if(identity.current===id&&!isStaleRequest(error))notify((error as Error).message);}finally{if(identity.current===id&&version===selectionEpoch.current)setSelectionBusy(false);}}
  useEffect(()=>{
    if(!auth?.authenticated||!galleryViews.includes(view))return;
    const version=++generation.current;const filter=`${view}:${query}:${source}:${folder??'<all>'}:${kind}`;
    const changed=lastFilter.current!==filter;lastFilter.current=filter;
    const previous=photosRef.current;const count=changed?90:Math.max(90,previous.length);
    const viewingId=selected===null?null:previous[selected]?.id;
    setError('');setLoadingMore(false);if(changed){setLoading(true);setPhotos([]);setSelected(null);}
    async function load(){try{
      if(viewingId&&!changed){try{await api<Photo>('/photos/'+viewingId);}catch(error){if((error as Error&{status?:number}).status===404&&version===generation.current)setSelected(null);else throw error;}return;}
      if(view==='albums'){const data=await api<Folder[]>('/folders');if(version===generation.current){setFolders(data);setTotal(data.length);}}
      else{
        const items:Photo[]=[];let found=0;
        for(let offset=0;offset<count;offset+=150){const p=params(offset);p.set('limit',String(Math.min(150,count-offset)));const data=await api<{items:Photo[];total:number}>(`/photos?${p}`);items.push(...data.items);found=data.total;if(items.length>=found)break;}
        if(version===generation.current){setPhotos(items);setTotal(found);setSelected(old=>{if(old===null)return null;const id=previous[old]?.id;const next=items.findIndex(p=>p.id===id);return next<0?null:next;});}
      }
    }catch(e){if(version===generation.current&&!isStaleRequest(e))setError((e as Error).message);}finally{if(version===generation.current)setLoading(false);}}
    void load();return()=>{generation.current++;};
  },[auth?.user?.id,auth?.authenticated,view,query,source,folder,kind,revision,selected]);
  async function loadMore(){const version=generation.current;setLoadingMore(true);try{const data=await api<{items:Photo[];total:number}>(`/photos?${params(photos.length)}`);if(version===generation.current){setPhotos(old=>[...old,...data.items]);setTotal(data.total);}}catch(e){if(version===generation.current&&!isStaleRequest(e))notify((e as Error).message);}finally{if(version===generation.current)setLoadingMore(false);}}
  async function favorite(photo:Photo){
    const id=identity.current;try{await api(`/photos/${photo.id}/favorite`,'PATCH',{favorite:!photo.favorite});if(identity.current!==id)return;setPhotos(old=>old.map(p=>p.id===photo.id?{...p,favorite:!p.favorite}:p));void refresh();if(view==='favorites'&&photo.favorite){setSelected(null);setRevision(r=>r+1);}notify(photo.favorite?'已取消收藏':'已加入收藏');}catch(e){if(identity.current===id&&!isStaleRequest(e))notify((e as Error).message);}
  }
  async function logout(){try{await api('/auth/logout','POST',{});await checkAuth();}catch(e){notify((e as Error).message);}}
  async function changePlayback(patch:Partial<PlaybackPreferences>){const id=identity.current;const next=await api<PlaybackPreferences>('/preferences','PATCH',patch);if(identity.current!==id)return;setAuth(old=>old?.user?.id===id?{...old,playback:next}:old);notify('播放设置已保存');}
  function deleted(result:DeleteResult){const removed=new Set(result.removed||result.moved);setDeleteTarget(null);setSelected(null);setPhotos(old=>old.filter(p=>!removed.has(p.id)));setTotal(old=>Math.max(0,old-removed.size));setPicked(new Set(result.failures.map(item=>item.id)));setSelecting(result.failures.length>0);setRevision(r=>r+1);void refresh();notify(result.failures.length?`已移入回收站 ${result.moved.length} 项，${result.failures.length} 项未完成。${result.failures[0].error}`:`已移入回收站 ${result.moved.length} 项，可在设置中恢复`);}
  function cancelDelete(){const returnId=deleteTarget?.returnId;setDeleteTarget(null);if(returnId){const index=photosRef.current.findIndex(p=>p.id===returnId);if(index>=0)setSelected(index);}}
  function navigate(next:View){setView(next);setSelecting(false);setPicked(new Set());setFolder(undefined);setSource('');setKind('');setSearch('');setSelected(null);window.scrollTo({top:0,behavior:'instant'});}
  async function scan(){try{await api('/scan','POST',{});await refresh();notify('正在检查新增和修改的照片');}catch(e){notify((e as Error).message);}}
  const stats=status?.stats||emptyStats,scanning=!!status?.scan.running;
  const offline=status?.sources.filter(s=>s.status==='offline')||[];
  const groups=new Map<string,Photo[]>();for(const photo of photos){const key=dateText(photo.takenAt,{year:'numeric',month:'long'});groups.set(key,[...(groups.get(key)||[]),photo]);}
  const title=folder!==undefined?(folder.split('/').pop()||status?.sources.find(s=>s.id===source)?.name||'照片目录'):({timeline:'所有照片',albums:'我的相册',favorites:'心里的偏爱',live:'鲜活的瞬间',settings:'设置',sources:'照片来源',account:'我的账号',users:'账号管理',shares:'我的分享',trash:'回收站'} as Record<View,string>)[view];
  const subtitle=({timeline:'每一个平常的日子，都有值得留下的一帧。',albums:'沿着熟悉的文件夹，重温每一段旅程。',favorites:'那些让你愿意再看一眼的瞬间。',live:'让照片动起来，让那一刻再次发生。',settings:'',sources:'',account:'',users:'',shares:'',trash:''} as Record<View,string>)[view];
  if(authError)return <main className="connection-page"><CloudOff size={36}/><h1>暂时联系不上相册</h1><p>{authError}</p><button className="primary" onClick={checkAuth}><RefreshCw size={16}/>重新连接</button></main>;
  if(!auth)return <main className="connection-page"><LoaderCircle size={28} className="spin"/><p>正在打开相册…</p></main>;
  if(!auth.authenticated||!auth.user)return <AuthScreen key={String(auth.setup)} setup={auth.setup} setupAllowed={auth.setupAllowed} onLogin={checkAuth}/>;
  const navItems:[View,typeof Images,string,number|undefined][]=[['timeline',Images,'所有照片',stats.total],['albums',FolderOpen,'我的相册',undefined],['favorites',Heart,'收藏',stats.favorites],['live',Radio,'实况照片',stats.live]];
  const managementItems:[View,typeof Images,string][]=[['settings',Settings2,'设置'],['shares',Link2,'我的分享'],['sources',HardDrive,'照片来源'],['account',UserRound,'我的账号'],...(auth.user.role==='admin'?[['users',Users,'账号管理'] as [View,typeof Images,string]]:[])];
  return <div className={`app-shell ${selecting?'is-selecting':''}`}>
    <aside className="sidebar"><a className="brand" href="/" onClick={e=>{e.preventDefault();navigate('timeline');}}><span className="brand-mark"><Aperture size={22}/></span><span>Keeplive</span></a><div className="sidebar-label">我的影像</div><nav aria-label="相册导航">{navItems.map(([id,Icon,label,count])=><button key={id} className={`nav-item ${view===id?'active':''}`} onClick={()=>navigate(id)}><Icon size={19}/><span>{label}</span>{count!==undefined&&<small>{count.toLocaleString()}</small>}</button>)}</nav>
      <div className="sidebar-source"><div className="sidebar-label">照片来源<button className="small-icon" aria-label="添加照片来源" onClick={()=>navigate('sources')}><Plus size={15}/></button></div>{status?.sources.slice(0,6).map(s=><button key={s.id} className={`source-link ${source===s.id?'chosen':''}`} onClick={()=>{navigate('timeline');setSource(s.id);}}><span className={`connection-dot ${s.status==='offline'?'off':''}`}/><span>{s.name}</span><ChevronRight size={13}/></button>)}{!status?.sources.length&&<button className="add-source-link" onClick={()=>navigate('sources')}><Plus size={15}/>连接照片目录</button>}</div>
      <div className="sidebar-bottom"><div className="local-status"><HardDrive size={17}/><div><strong>{auth.user.displayName} 的相册</strong><span>原始照片，本地保存</span></div></div><nav className="management-nav" aria-label="相册管理">{managementItems.map(([id,Icon,label])=><button key={id} className={`nav-item ${view===id?'active':''}`} aria-current={view===id?'page':undefined} onClick={()=>navigate(id)}><Icon size={18}/><span>{label}</span></button>)}</nav><button className="nav-item signout" onClick={logout}><LogOut size={17}/><span>退出相册</span></button></div>
    </aside>
    <div className="main-column"><header className="topbar"><a className="mobile-brand" href="/" onClick={e=>{e.preventDefault();navigate('timeline');}}><Aperture size={22}/>Keeplive</a><div className="breadcrumbs"><span>我的影像</span><ChevronRight size={13}/><strong>{view==='timeline'?'照片库':view==='albums'?'我的相册':view==='favorites'?'收藏':view==='live'?'实况照片':title}</strong></div><div className="topbar-actions">{(galleryViews.includes(view)||view==='sources')&&<button className="scan-button" onClick={scan} disabled={scanning} title="已开启自动同步；需要时可立即检查照片变化"><RefreshCw size={16} className={scanning?'spin':''}/><span>{scanning?'正在同步':'立即检查'}</span></button>}</div></header>
      <main className="main-content">{view==='settings'?<Settings key={auth.user.id} user={auth.user} playback={auth.playback??defaultPlayback} onPlaybackChange={changePlayback} onNavigate={navigate} onBack={()=>navigate('timeline')} onLogout={logout}/>:view==='trash'?<Trash key={auth.user.id} onBack={()=>navigate('settings')} onRestored={()=>{void refresh();setRevision(r=>r+1);notify('照片已恢复到原位置');}}/>:view==='shares'?<MyShares key={auth.user.id} onBack={()=>navigate('timeline')} notify={notify} libraryVersion={status?.version||0}/>:view==='sources'?<Sources key={auth.user.id} status={status} user={auth.user} onRefresh={()=>{void refresh();setRevision(r=>r+1);}} onBack={()=>navigate('timeline')} notify={notify}/>:view==='account'||view==='users'?<section className="settings-page"><button className="text-button" onClick={()=>navigate('timeline')}><ArrowLeft size={17}/>返回相册</button><Account key={`${auth.user.id}:${view}`} user={auth.user} admin={view==='users'&&auth.user.role==='admin'} onUserChange={checkAuth} onLogout={logout} notify={notify}/></section>:<>
        <div className="page-heading"><div><span className="eyebrow">{view==='live'?'MOMENTS IN MOTION':view==='favorites'?'CLOSE TO THE HEART':'THE EVERYDAY ARCHIVE'}</span><h1>{title}<span className="heading-point">.</span></h1><p>{folder!==undefined?`${status?.sources.find(s=>s.id===source)?.name||''} · ${folder||'根目录'}`:subtitle}</p></div><div className="heading-count"><strong>{view==='albums'?folders.length:stats.total.toLocaleString()}</strong><span>{view==='albums'?'个相册':'段影像记忆'}</span></div></div>
        {offline.length>0&&<div className="notice"><CloudOff size={17}/><span>{offline.map(s=>s.name).join('、')} 暂未连接。连接硬盘后会自动恢复。</span><button onClick={()=>navigate('sources')}>查看目录<ArrowUpRight size={14}/></button></div>}
        {scanning&&<div className="scan-progress" role="status"><LoaderCircle size={16} className="spin"/><span>正在整理照片 · {status?.scan.processed} / {status?.scan.total}</span><div><i style={{width:`${status?.scan.total?Math.min(100,status.scan.processed/status.scan.total*100):5}%`}}/></div></div>}
        {status?.scan.error&&<div className="notice error-notice" role="alert">扫描未完成：{status.scan.error}<button onClick={scan}>重试</button></div>}
        {view!=='albums'&&<div className="library-toolbar"><FilterTabs value={view==='live'?'live':kind} liveOnly={view==='live'} onChange={setKind}/><div className="toolbar-right"><button className={`secondary select-mode-button ${selecting?'active':''}`} aria-pressed={selecting} onClick={()=>{selectionEpoch.current++;setSelectionBusy(false);setSelecting(!selecting);setPicked(new Set());}}><CheckSquare size={16}/>{selecting?'取消选择':'选择'}</button><label className="search-box"><Search size={17}/><input aria-label="搜索照片和文件夹" placeholder="搜索照片、文件夹…" value={search} onChange={e=>setSearch(e.target.value)}/>{search&&<button className="small-icon" aria-label="清空搜索" onClick={()=>setSearch('')}><X size={15}/></button>}</label><span className="result-count">{total.toLocaleString()} 项</span></div></div>}
        {(source||folder!==undefined)&&<button className="text-button folder-back" onClick={()=>{setSource('');setFolder(undefined);}}><ArrowLeft size={15}/>全部照片</button>}
        {error?<div className="empty-state"><CloudOff size={34}/><h2>照片暂时没有加载出来</h2><p>{error}</p><button className="secondary" onClick={()=>{setRevision(r=>r+1);void refresh();}}>重新加载</button></div>:loading?<div className="skeleton-grid">{Array.from({length:12},(_,i)=><div key={i}/>)}</div>:view==='albums'?<div className="album-grid">{folders.map(f=><button className="album-card" key={`${f.sourceId}:${f.folder}`} onClick={()=>{setSource(f.sourceId);setFolder(f.folder);setView('timeline');}}><div className="album-cover"><img loading="lazy" src={`/api/media/${f.cover}/thumb`} alt=""/><span><FolderOpen size={18}/></span></div><div className="album-text"><h3>{f.folder.split('/').pop()||f.sourceName}</h3><p>{f.sourceName} · {f.count} 项</p><ArrowUpRight size={18}/></div></button>)}{!folders.length&&<Empty onAdd={()=>navigate('sources')}/>}</div>:photos.length?<div className="timeline">{[...groups.entries()].map(([month,items])=><section className="month-section" key={month}><div className="month-heading"><h2>{month}</h2><span>{items.length} 个瞬间</span>{selecting&&<button className="text-button month-select" disabled={selectionBusy} onClick={()=>void selectMatching(items)}>{items.every(photo=>picked.has(photo.id))?'取消本月':'选择本月'}</button>}<div/></div><div className="photo-grid">{items.map(p=><PhotoCard key={`${p.id}-${p.version}`} photo={p} selecting={selecting} picked={picked.has(p.id)} selectionBusy={selectionBusy} onOpen={()=>selecting?pick(p.id):setSelected(photos.findIndex(item=>item.id===p.id))} onFavorite={()=>favorite(p)}/>)}</div></section>)}{photos.length<total&&<button className="secondary load-more" disabled={loadingMore} onClick={loadMore}>{loadingMore&&<LoaderCircle className="spin" size={16}/>}加载更多照片</button>}<div className="archive-end"><Aperture size={15}/><span>已展示 {photos.length} / {total} 项 · 每一刻，都值得留住。</span></div></div>:stats.total>0?<div className="empty-state"><Heart size={32}/><h2>{view==='favorites'?'把喜欢的瞬间，放在这里':'没有找到符合条件的照片'}</h2><p>{view==='favorites'?'点击照片上的爱心，建立你自己的精选相册。':'试试其他关键词，或切换照片类型。'}</p></div>:<Empty onAdd={()=>navigate('sources')}/>
        }
      </>}</main>
    </div>
    <nav className="mobile-nav" aria-label="手机相册导航">{[...navItems.map(([id,Icon,label])=>({id,Icon,label:id==='timeline'?'照片':id==='albums'?'相册':id==='live'?'实况':label})),{id:'settings' as View,Icon:Settings2,label:'设置'}].map(({id,Icon,label})=>{const active=view===id||(id==='settings'&&!galleryViews.includes(view));return <button key={id} className={active?'active':''} aria-current={active?'page':undefined} onClick={()=>navigate(id)}><Icon size={20}/><span>{label}</span></button>;})}</nav>
    {toast&&<div className="toast" role="status"><Check size={16}/><span>{toast}</span><button className="small-icon" aria-label="关闭提示" onClick={()=>setToast('')}><X size={14}/></button></div>}
    {selecting&&<div className="selection-bar"><div className="selection-count">{selectionBusy?<><LoaderCircle size={16} className="spin"/>正在选择…</>:<>已选 <strong>{picked.size.toLocaleString()}</strong> 项</>}</div><div className="selection-bar-actions"><button className="text-button" disabled={selectionBusy} title="全选当前筛选结果，包括尚未加载的照片" onClick={()=>void selectMatching()}>全选</button><button className="text-button" disabled={selectionBusy||!picked.size} onClick={()=>setPicked(new Set())}>清空</button><button className="text-button selection-delete" disabled={selectionBusy||!picked.size} onClick={()=>setDeleteTarget({ids:[...picked]})}><Trash2 size={16}/>删除</button><button className="primary" disabled={selectionBusy||!picked.size} onClick={()=>setShareOpen(true)}><Link2 size={16}/>创建分享</button></div></div>}
    {shareOpen&&<ShareDialog key={auth.user.id} ids={[...picked]} onClose={()=>setShareOpen(false)} onCreated={()=>{setSelecting(false);setPicked(new Set());notify('分享相册已创建');}}/>}
    {deleteTarget&&<DeleteDialog key={auth.user.id} ids={deleteTarget.ids} filename={deleteTarget.filename} onClose={cancelDelete} onDeleted={deleted}/>}
    {selected!==null&&photos[selected]&&<Viewer photos={photos} index={selected} playback={auth.playback??defaultPlayback} onIndex={setSelected} onClose={()=>setSelected(null)} onFavorite={favorite} onDelete={photo=>{setSelected(null);setDeleteTarget({ids:[photo.id],filename:photo.filename,returnId:photo.id});}}/>}
  </div>;
}

function Empty({onAdd}:{onAdd:()=>void}){return <div className="empty-state first-empty"><div className="empty-frames" aria-hidden="true"><div><Images size={32}/></div><div><Radio size={28}/></div></div><span className="eyebrow">MAKE ROOM FOR MEMORIES</span><h2>你的日子，从这里开始留存。</h2><p>添加一个照片文件夹，就能把电脑和移动硬盘里的<br className="desktop-break"/>照片、视频和实况图，收进同一本相册。</p><button className="primary" onClick={onAdd}><Plus size={18}/>添加照片目录</button><small><HardDrive size={13}/>原始照片保留在你的设备上</small></div>;}




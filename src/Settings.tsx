import { useState } from 'react';
import { ArrowLeft,ChevronRight,HardDrive,LogOut,UserRound,Users,Radio,Play,LoaderCircle,Link2,Trash2 } from 'lucide-react';
import type { User } from './api';
import { qualityOptions,type PlaybackPreferences } from './playback';

export type SettingsDestination='sources'|'account'|'users'|'shares'|'trash';
export default function Settings({user,playback,onPlaybackChange,onNavigate,onBack,onLogout}:{user:User;playback:PlaybackPreferences;onPlaybackChange:(patch:Partial<PlaybackPreferences>)=>Promise<void>;onNavigate:(view:SettingsDestination)=>void;onBack:()=>void;onLogout:()=>void}){
  const [saving,setSaving]=useState(false),[error,setError]=useState('');
  async function change(patch:Partial<PlaybackPreferences>){setSaving(true);setError('');try{await onPlaybackChange(patch);}catch(error){setError((error as Error).message);}finally{setSaving(false);}}
  const entries=[
    {id:'trash' as const,Icon:Trash2,title:'回收站',description:'找回移除的照片、实况和视频'},
    {id:'shares' as const,Icon:Link2,title:'我的分享',description:'管理分享链接、有效期与下载权限'},
    {id:'sources' as const,Icon:HardDrive,title:'照片来源',description:'添加、修改照片目录，更新相册'},
    {id:'account' as const,Icon:UserRound,title:'我的账号',description:'修改显示名称和登录密码'},
    ...(user.role==='admin'?[{id:'users' as const,Icon:Users,title:'账号管理',description:'创建账号，为每个人分配照片目录'}]:[]),
  ];
  return <section className="settings-page settings-home">
    <button className="text-button" onClick={onBack}><ArrowLeft size={17}/>返回相册</button>
    <div className="page-heading"><div><span className="eyebrow">YOUR OWN SPACE</span><h1>设置</h1><p>按你的习惯，浏览值得留下的日子。</p></div></div>
    <section className="playback-settings" aria-labelledby="playback-settings-title">
      <div className="playback-settings-heading"><h2 id="playback-settings-title">播放设置</h2><p>设置自动保存到你的账号。</p>{saving&&<span role="status"><LoaderCircle size={14} className="spin"/>正在保存…</span>}</div>
      <fieldset className="quality-setting" disabled={saving} aria-describedby="quality-hint">
        <legend>播放清晰度</legend><p id="quality-hint">同时用于实况和视频。原始清晰度保留源分辨率，首次加载可能更久。</p>
        <div className="quality-options">{qualityOptions.map(({value,label,description})=><label className={`quality-option ${playback.videoQuality===value?'selected':''}`} key={value}>
          <input type="radio" name="video-quality" value={value} checked={playback.videoQuality===value} onChange={()=>void change({videoQuality:value})}/>
          <span><strong>{label}</strong><span>{description}</span></span>
        </label>)}</div>
        <p className="quality-footnote">网页播放会生成兼容格式的副本，不等同于无损播放；原文件始终保留。</p>
      </fieldset>
      {([{key:'liveSound',Icon:Radio,title:'实况声音',description:'打开实况照片时播放声音'},{key:'videoSound',Icon:Play,title:'视频声音',description:'播放视频时打开声音'}] as const).map(({key,Icon,title,description})=><div className="sound-setting-row" key={key}><span className="settings-menu-icon"><Icon size={21}/></span><span className="settings-menu-copy"><strong id={`sound-${key}`}>{title}</strong><span id={`sound-${key}-hint`}>{description}</span></span><button type="button" role="switch" aria-checked={playback[key]} aria-labelledby={`sound-${key}`} aria-describedby={`sound-${key}-hint`} className={`sound-switch ${playback[key]?'on':''}`} disabled={saving} onClick={()=>void change({[key]:!playback[key]})}><span/></button></div>)}
      {error&&<p className="form-error" role="alert">{error}</p>}
    </section>
    <nav className="settings-menu" aria-label="设置项目">{entries.map(({id,Icon,title,description})=><button className="settings-menu-item" key={id} onClick={()=>onNavigate(id)}><span className="settings-menu-icon"><Icon size={23}/></span><span className="settings-menu-copy"><strong>{title}</strong><span>{description}</span></span><ChevronRight size={18}/></button>)}</nav>
    <button className="secondary account-logout" onClick={onLogout}><LogOut size={16}/>退出登录</button>
  </section>;
}

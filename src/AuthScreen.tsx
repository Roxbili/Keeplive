import { useState,type FormEvent } from 'react';
import { Aperture,ArrowRight,LockKeyhole,LoaderCircle } from 'lucide-react';
import { api } from './api';

export default function AuthScreen({setup,setupAllowed,onLogin}:{setup:boolean;setupAllowed:boolean;onLogin:()=>void}){
  const [username,setUsername]=useState(''),[displayName,setDisplayName]=useState(''),[password,setPassword]=useState(''),[confirmation,setConfirmation]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function submit(e:FormEvent){e.preventDefault();setError('');if(setup&&password!==confirmation){setError('两次输入的密码不一致');return;}setBusy(true);try{await api(setup?'/auth/setup':'/auth/login','POST',{username,displayName:displayName||username,password});onLogin();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  return <main className="auth-page">
    <div className="auth-story"><a className="brand" href="/" aria-label="Keeplive 首页"><span className="brand-mark"><Aperture size={23}/></span><span>Keeplive</span></a>
      <div className="story-copy"><span className="eyebrow">YOUR LIFE, IN FRAMES</span><h1>照片里的日子，<br/>一直鲜活。</h1><p>那些平常的、特别的、值得记住的瞬间。<br/>留在你的硬盘里，也留在随时能翻开的相册里。</p></div>
      <div className="frame-art" aria-hidden="true"><div className="art-frame frame-one"><div className="art-landscape"><i/><b/></div><span>把光留住</span></div><div className="art-frame frame-two"><div className="art-sea"><i/></div><span>让回忆有声</span></div><div className="art-caption">A little archive of everyday life.</div></div>
      <span className="story-footer">私人影像 · 本地保存 · 实况回放</span>
    </div>
    <section className="auth-form-wrap"><form className="auth-form" onSubmit={submit}><span className="auth-lock"><LockKeyhole size={23}/></span><h2>{setup?'创建你的管理员账号':'欢迎回到你的相册'}</h2><p>{setup?'从这里开始，为每个人留一份独立的照片空间。':'登录你的账号，接着看看值得留下的日子。'}</p>
      {setup&&!setupAllowed?<div className="setup-local-note" role="status"><strong>请先在家中电脑创建管理员</strong><p>在运行 Keeplive 的电脑上打开本地地址，完成首次设置后，就可以用账号远程登录。</p></div>:<>
        <label>用户名<input autoFocus required autoComplete="username" minLength={3} maxLength={32} pattern="[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,31}" value={username} onChange={e=>setUsername(e.target.value)} placeholder={setup?'例如：fanding':'输入你的用户名'} spellCheck={false}/>{setup&&<small>3–32 位英文字母、数字、点、下划线或短横线。</small>}</label>
        {setup&&<label>显示名称<input maxLength={40} value={displayName} onChange={e=>setDisplayName(e.target.value)} placeholder="你希望相册怎么称呼你" autoComplete="nickname"/></label>}
        <label>{setup?'设置密码':'密码'}<input required type="password" autoComplete={setup?'new-password':'current-password'} minLength={setup?8:undefined} maxLength={128} value={password} onChange={e=>setPassword(e.target.value)} placeholder={setup?'至少 8 个字符':'输入你的密码'} aria-describedby={setup?'setup-password-hint':undefined}/>{setup&&<small id="setup-password-hint">请勿设置常用密码</small>}</label>
        {setup&&<label>确认密码<input required type="password" autoComplete="new-password" minLength={8} maxLength={128} value={confirmation} onChange={e=>setConfirmation(e.target.value)} placeholder="再次输入密码"/></label>}
        {error&&<p className="form-error" role="alert">{error}</p>}<button className="primary auth-submit" disabled={busy}>{busy?<LoaderCircle className="spin" size={18}/>:<>{setup?'创建账号，开启相册':'打开我的相册'}<ArrowRight size={18}/></>}</button>
      </>}
      <div className="auth-note"><LockKeyhole size={13}/><span>{setup?'首次创建的账号为管理员':'新账号由管理员创建，照片和收藏各自独立'}</span></div>
    </form></section>
  </main>;
}


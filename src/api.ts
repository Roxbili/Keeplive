export interface Photo { id:string; sourceId:string; sourceName:string; folder:string; filename:string; kind:'photo'|'live'|'video'; takenAt:string; width:number; height:number; duration:number; favorite:boolean; available:boolean; version:string }
export interface Source { id:string; name:string; path:string; recursive:boolean; status:string; count:number; error:string|null; lastScan:string|null }
export interface Folder { sourceId:string; sourceName:string; folder:string; cover:string; count:number; latest:string }
export interface Status { version:number; scan:{running:boolean; processed:number; total:number; error:string|null; finishedAt:string|null}; stats:{total:number;live:number;videos:number;favorites:number;firstDate:string|null;lastDate:string|null}; sources:Source[] }
export interface User { id:string; username:string; displayName:string; role:'admin'|'member'; active:boolean; allowedRoots:string[]; createdAt:string }
export interface AuthStatus { setup:boolean; setupAllowed:boolean; authenticated:boolean; user:User|null; playback?:import('./playback').PlaybackPreferences }
let identity:string|null=null,epoch=0;
export function setApiIdentity(value:string|null){if(identity!==value){identity=value;epoch++;}}
export const isStaleRequest=(error:unknown)=>error instanceof Error&&error.name==='AbortError';
export async function api<T>(url:string,method='GET',body?:unknown,options:{signal?:AbortSignal}={}):Promise<T>{
  const rotates=method!=='GET'&&(['/auth/setup','/auth/login','/auth/logout'].includes(url)||url.endsWith('/password'));
  if(rotates)epoch++;
  const started=epoch,expected=identity;
  let response:Response;
  try{response=await fetch(`/api${url}`,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(expected?{'X-Keeplive-Expected':expected}:{})},body:body?JSON.stringify(body):undefined,signal:options.signal});}
  catch(error){if((error as Error).name==='AbortError')throw error;throw new Error('暂时无法连接相册，请检查家中电脑是否在线');}
  const data=await response.json().catch(()=>({error:'家中相册暂时离线，请稍后重试'}));
  if(started!==epoch)throw Object.assign(new Error('忽略过期会话的响应'),{name:'AbortError'});
  const actual=response.headers.get('X-Keeplive-User');
  if(actual&&actual!==expected){window.dispatchEvent(new Event('keeplive:accountchange'));throw new Error('账号已切换，正在打开当前相册');}
  if(!response.ok){if(response.status===401&&!url.startsWith('/auth/'))window.dispatchEvent(new Event('keeplive:logout'));throw Object.assign(new Error(data.error||'操作失败，请重试'),{status:response.status,code:data.code});}
  if(rotates)epoch++;
  return data as T;
}
export const mediaURL=(p:Photo,variant:string)=>`/api/media/${p.id}/${variant}?v=${p.version}`;
export const dateText=(value:string,options:Intl.DateTimeFormatOptions={year:'numeric',month:'long',day:'numeric'})=>new Date(value).toLocaleDateString('zh-CN',options);

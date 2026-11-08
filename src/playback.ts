export type VideoQuality='original'|'high'|'smooth';
export interface PlaybackPreferences {liveSound:boolean;videoSound:boolean;videoQuality:VideoQuality}
export const defaultPlayback:PlaybackPreferences={liveSound:true,videoSound:true,videoQuality:'original'};
export const qualityOptions:ReadonlyArray<{value:VideoQuality;label:string;description:string}>=[
  {value:'original',label:'原始清晰度',description:'保留源分辨率，优先画质'},
  {value:'high',label:'高清',description:'最长边 1920 像素，兼顾画质与速度'},
  {value:'smooth',label:'流畅',description:'最长边 1280 像素，适合较慢网络'},
];
export const playbackURL=(url:string,quality:VideoQuality)=>`${url}${url.includes('?')?'&':'?'}quality=${quality}`;
const sharedQualityKey='keeplive:shared-video-quality';
export function readSharedQuality(storage?:Pick<Storage,'getItem'>):VideoQuality{
  try{const value=(storage||window.localStorage).getItem(sharedQualityKey);return qualityOptions.some(option=>option.value===value)?value as VideoQuality:'original';}catch{return 'original';}
}
export function saveSharedQuality(quality:VideoQuality,storage?:Pick<Storage,'setItem'>){try{(storage||window.localStorage).setItem(sharedQualityKey,quality);}catch{/* Viewing also works with browser storage disabled. */}}

export async function playLive(video:Pick<HTMLVideoElement,'muted'|'play'>,sound:boolean,isCurrent:()=>boolean=()=>true):Promise<'playing'|'muted'|'cancelled'>{
  video.muted=!sound;
  try{await video.play();}
  catch(error){
    if(!isCurrent())return 'cancelled';
    if(!sound||(error as Error).name!=='NotAllowedError')throw error;
    video.muted=true;
    await video.play();
    return isCurrent()?'muted':'cancelled';
  }
  return isCurrent()?'playing':'cancelled';
}

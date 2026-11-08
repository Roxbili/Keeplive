import { useEffect,useRef,useState } from 'react';
import { Heart } from 'lucide-react';

export default function FavoriteHeart({favorite,size}:{favorite:boolean;size:number}){
  const previous=useRef(favorite),[pulse,setPulse]=useState(false);
  useEffect(()=>{setPulse(favorite&&!previous.current&&!window.matchMedia('(prefers-reduced-motion: reduce)').matches);previous.current=favorite;},[favorite]);
  return <Heart size={size} fill={favorite?'currentColor':'transparent'} className={`favorite-heart ${pulse?'favorite-pop':''}`} onAnimationEnd={()=>setPulse(false)} aria-hidden="true"/>;
}

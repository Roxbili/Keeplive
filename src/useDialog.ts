import { useEffect,useRef } from 'react';

export function useDialog(open:boolean,onClose:()=>void,busy=false){
  const root=useRef<HTMLElement>(null),close=useRef(onClose),working=useRef(busy);close.current=onClose;working.current=busy;
  useEffect(()=>{
    if(!open)return;const before=document.activeElement as HTMLElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    const fields=()=>Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')||[]);fields()[0]?.focus();
    function keys(event:KeyboardEvent){if(event.key==='Escape'&&!working.current)close.current();if(event.key==='Tab'){const all=fields(),index=all.indexOf(document.activeElement as HTMLElement);if(index<0||event.shiftKey&&index===0||!event.shiftKey&&index===all.length-1){event.preventDefault();all[event.shiftKey?all.length-1:0]?.focus();}}}
    window.addEventListener('keydown',keys);return()=>{document.body.style.overflow=overflow;window.removeEventListener('keydown',keys);if(before?.isConnected)before.focus();};
  },[open]);return root;
}

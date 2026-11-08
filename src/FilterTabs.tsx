import { useLayoutEffect,useRef,useState } from 'react';
import { Radio } from 'lucide-react';

export default function FilterTabs({value,liveOnly,onChange}:{value:string;liveOnly:boolean;onChange:(value:string)=>void}){
  const root=useRef<HTMLDivElement>(null);
  const [indicator,setIndicator]=useState<{left:number;width:number}|null>(null);
  useLayoutEffect(()=>{
    const element=root.current;if(!element)return;
    function measure(){
      const selected=element!.querySelector<HTMLButtonElement>('button[aria-pressed="true"]');
      if(!selected){setIndicator(null);return;}
      const next={left:selected.offsetLeft,width:selected.offsetWidth};
      setIndicator(old=>old?.left===next.left&&old.width===next.width?old:next);
    }
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect();
  },[value,liveOnly]);
  return <div ref={root} className={`filter-tabs animated-filter-tabs ${indicator?'has-indicator':''}`} aria-label="照片类型">
    {indicator&&<span className="filter-indicator" aria-hidden="true" style={{width:indicator.width,transform:`translateX(${indicator.left}px)`}}/>}
    {[['','全部'],['live','实况'],['video','视频']].filter(([key])=>!liveOnly||key==='live').map(([key,label])=><button key={key} type="button" className={value===key?'selected':''} aria-pressed={value===key} onClick={()=>onChange(key)}>{label}{key==='live'&&<Radio size={13}/>}</button>)}
  </div>;
}

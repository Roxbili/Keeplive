import type { Folder,Source } from './api';

const folderOrder=new Intl.Collator('zh-CN',{numeric:true});

interface Props {
  sources: Source[];
  folders: Folder[];
  source: string;
  folder: string|undefined;
  onChange: (source: string,folder: string|undefined) => void;
}

export default function FolderFilter({sources,folders,source,folder,onChange}:Props){
  const groups=new Map(sources.map(({id,name})=>[id,{name,folders:new Set<string>()}]));
  for(const entry of folders){
    const group=groups.get(entry.sourceId)??{name:entry.sourceName,folders:new Set<string>()};
    group.folders.add(entry.folder);
    groups.set(entry.sourceId,group);
  }
  if(source){
    const group=groups.get(source)??{name:'当前来源',folders:new Set<string>()};
    if(folder!==undefined)group.folders.add(folder);
    groups.set(source,group);
  }

  return <select className="folder-filter" aria-label="按文件夹筛选" disabled={!groups.size}
    value={JSON.stringify([source,folder])} onChange={event=>{
      const [nextSource,nextFolder]:[string,string|null]=JSON.parse(event.currentTarget.value);
      onChange(nextSource,nextFolder??undefined);
    }}>
    <option value={JSON.stringify(['',null])}>全部文件夹</option>
    {[...groups].map(([id,group])=><optgroup key={id} label={group.name}>
      <option value={JSON.stringify([id,null])}>{group.name} · 全部文件夹</option>
      {[...group.folders].sort(folderOrder.compare).map(path=>
        <option key={path} value={JSON.stringify([id,path])}>{path||'根目录'}</option>
      )}
    </optgroup>)}
  </select>;
}

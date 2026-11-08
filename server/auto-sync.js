import { watch } from 'node:fs';
import { realpath,stat } from 'node:fs/promises';
import path from 'node:path';

export class AutoSync {
  constructor(store,library,{debounceMs=1500,maxWaitMs=5000,watchIntervalMs=3000,pollIntervalMs=60000,watchFactory=watch}={}){
    this.store=store;this.library=library;this.debounceMs=debounceMs;this.maxWaitMs=maxWaitMs;this.watchIntervalMs=watchIntervalMs;this.pollIntervalMs=pollIntervalMs;this.watchFactory=watchFactory;
    this.watchers=new Map();this.observed=new Map();this.dirty=new Set();this.closed=false;this.flushing=null;this.reconciling=null;
  }
  async start(){
    await this.reconcile();if(this.closed)return;
    this.watchTimer=setInterval(()=>{void this.reconcile();},this.watchIntervalMs);this.watchTimer.unref();
    this.pollTimer=setInterval(()=>{void this.reconcile().then(()=>{if(this.closed)return;for(const source of this.store.sources())this.schedule(source.ownerId??undefined);});},this.pollIntervalMs);this.pollTimer.unref();
  }
  drop(id){const previous=this.watchers.get(id);if(previous){this.watchers.delete(id);previous.handle.close();}}
  reconcile(){
    if(this.closed)return Promise.resolve();if(this.reconciling)return this.reconciling;
    this.reconciling=this.syncWatchers().catch(error=>{if(!this.closed)console.warn('[Keeplive 自动同步]',error.message);}).finally(()=>{this.reconciling=null;});return this.reconciling;
  }
  async syncWatchers(){
    const sources=this.store.sources(),ids=new Set(sources.map(source=>source.id));
    for(const id of this.observed.keys())if(!ids.has(id)){this.drop(id);this.observed.delete(id);}
    for(const source of sources){
      if(this.closed)return;
      let signature='offline';
      try{const [actual,info]=await Promise.all([realpath(source.path),stat(source.path)]);if(!info.isDirectory()||path.relative(path.resolve(source.path),actual)!=='')throw new Error('source changed');signature=JSON.stringify([source.path,source.recursive,source.ownerId,info.dev,info.ino]);}catch{}
      if(this.closed)return;
      if(this.observed.get(source.id)!==signature){this.drop(source.id);this.observed.set(source.id,signature);this.schedule(source.ownerId??undefined);}
      if(signature==='offline'||this.watchers.has(source.id))continue;
      try{
        const handle=this.watchFactory(source.path,{recursive:source.recursive},()=>this.schedule(source.ownerId??undefined));
        handle.on('error',()=>{this.drop(source.id);this.schedule(source.ownerId??undefined);});handle.unref?.();
        this.watchers.set(source.id,{handle,path:source.path,signature});
      }catch{/* A disconnected drive or unsupported watcher is covered by periodic scans. */}
    }
  }
  schedule(owner){
    if(this.closed)return;this.dirty.add(owner);clearTimeout(this.debounceTimer);
    this.debounceTimer=setTimeout(()=>this.kick(),this.debounceMs);this.debounceTimer.unref();
    if(!this.maxTimer){this.maxTimer=setTimeout(()=>this.kick(),this.maxWaitMs);this.maxTimer.unref();}
  }
  kick(){
    clearTimeout(this.debounceTimer);clearTimeout(this.maxTimer);this.debounceTimer=null;this.maxTimer=null;
    if(this.closed||this.flushing)return;
    this.flushing=this.flush().finally(()=>{this.flushing=null;if(!this.closed&&this.dirty.size)this.schedule(this.dirty.values().next().value);});
  }
  async flush(){
    while(!this.closed&&this.dirty.size){
      const owners=[...this.dirty];this.dirty.clear();
      for(const owner of owners){
        // Library.scan reuses a running job. Wait first so events received during
        // that job always cause a fresh pass, including a late copy or deletion.
        while(!this.closed&&this.library.current)await this.library.current;
        if(this.closed)return;
        try{await this.library.scan(owner);}catch(error){if(!this.closed)console.warn('[Keeplive 自动同步]',error.message);}
      }
    }
  }
  async close(){
    this.closed=true;clearInterval(this.watchTimer);clearInterval(this.pollTimer);clearTimeout(this.debounceTimer);clearTimeout(this.maxTimer);
    if(this.reconciling)await this.reconciling;for(const id of this.watchers.keys())this.drop(id);this.dirty.clear();if(this.flushing)await this.flushing;
  }
}

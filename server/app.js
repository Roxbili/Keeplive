import express from 'express';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import path from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Store } from './store.js';
import { Library } from './library.js';
import { Media } from './media.js';
import { Auth,localSetup } from './auth.js';
import { passwordHash } from './users.js';
import { browseDirectories,directoryName } from './directories.js';
import { Shares } from './shares.js';
import { registerPublicShares,registerOwnerShares } from './share-routes.js';
import { NativeDirectoryPicker } from './native-directory.js';
import { defaultPlayback,isVideoQuality } from './playback.js';
import { PhotoTrash } from './trash.js';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const nativeLocal=req=>{
  if(!localSetup(req))return false;
  for(const header of ['Origin','Referer']){const value=req.get(header);if(value){try{if(new URL(value).host!==req.get('Host'))return false;}catch{return false;}}}
  return true;
};

export function createApp(options={}) {
  const publicOrigin=options.publicOrigin??process.env.PUBLIC_ORIGIN;
  const store=new Store(options.dataDir||process.env.DATA_DIR||path.join(project,'.data'));
  const library=new Library(store),media=new Media(store),auth=new Auth(store),shares=new Shares(store);
  const trash=new PhotoTrash(store,library);
  const nativePicker=options.nativePicker??new NativeDirectoryPicker();
  library.onAssets=assets=>media.warm(assets);
  const app=express();app.disable('x-powered-by');
  if(process.env.TRUST_PROXY)app.set('trust proxy',process.env.TRUST_PROXY);
  app.use(helmet({contentSecurityPolicy:{directives:{'img-src':["'self'",'data:','blob:'],'media-src':["'self'",'blob:'],'style-src':["'self'","'unsafe-inline'"],'upgrade-insecure-requests':null}},strictTransportSecurity:process.env.COOKIE_SECURE==='1'?undefined:false}));
  app.use('/api',(_,res,next)=>{res.set('Cache-Control','private, no-store');next();});
  app.use('/api/shares',express.json({limit:'2mb'}));
  app.use(express.json({limit:'32kb'}));
  app.use('/api',(req,res,next)=>{
    if(['GET','HEAD','OPTIONS'].includes(req.method))return next();
    const origin=req.get('Origin');
    let valid=false;try{const sameHost=new URL(origin).host===req.get('Host');valid=!!origin&&(publicOrigin?origin===publicOrigin||(localSetup(req)&&sameHost):sameHost);}catch{}
    if(!valid)return res.status(403).json({error:'请求来源不匹配，请从相册页面进行操作'});next();
  });
  const secure=process.env.COOKIE_SECURE==='1';
  const playback=userId=>({...defaultPlayback,...store.setting('playback:'+userId)});
  app.get('/api/auth/status',(req,res)=>{const user=auth.user(req);res.json({setup:!store.users.count(),setupAllowed:localSetup(req),authenticated:!!user,user:store.users.public(user),...(user?{playback:playback(user.id)}:{})});});
  const loginLimit=rateLimit({windowMs:15*60*1000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'尝试次数过多，请稍后再试'}});
  app.post('/api/auth/setup',(req,res,next)=>{if(store.users.count())throw fail(409,'相册已经初始化');if(!localSetup(req))throw fail(403,'请在运行相册的电脑上打开本地地址，创建第一个管理员');next();},loginLimit,async(req,res)=>{const user=await store.users.create(req.body,null,{initial:true});auth.login(req,res,user,secure);res.status(201).json(store.users.public(user));});
  app.post('/api/auth/login',loginLimit,async(req,res)=>{const user=await auth.authenticate(req.body.username,req.body.password);if(!user)throw fail(401,'用户名或密码不正确，或账号已停用');auth.login(req,res,user,secure);res.json(store.users.public(user));});
  app.post('/api/auth/logout',(req,res)=>{const user=auth.user(req);if(user&&req.get('X-Keeplive-Expected')&&req.get('X-Keeplive-Expected')!==user.id){res.set('X-Keeplive-User',user.id);throw fail(409,'账号已切换，请重新操作');}auth.logout(req,res,secure);res.json({ok:true});});
  registerPublicShares(app,{shares,media,secure});
  app.use('/api',(req,res,next)=>{req.user=auth.user(req);if(!req.user)return res.status(401).json({error:'请先登录相册'});res.set('X-Keeplive-User',req.user.id);if(req.get('X-Keeplive-Expected')&&req.get('X-Keeplive-Expected')!==req.user.id)throw fail(409,'账号已切换，请重新操作');next();});
  registerOwnerShares(app,{shares,publicOrigin});
  app.get('/api/auth/me',(req,res)=>res.json(store.users.public(req.user)));
  app.get('/api/preferences',(req,res)=>res.json(playback(req.user.id)));
  app.patch('/api/preferences',(req,res)=>{
    const input=req.body;
    if(!input||typeof input!=='object'||Array.isArray(input)||!Object.keys(input).length||Object.entries(input).some(([key,value])=>key==='videoQuality'?!isVideoQuality(value):!['liveSound','videoSound'].includes(key)||typeof value!=='boolean'))throw fail(400,'播放设置不正确');
    const next={...playback(req.user.id),...input};store.setSetting('playback:'+req.user.id,next);res.json(next);
  });
  app.patch('/api/auth/me',(req,res)=>res.json(store.users.public(store.users.profile(req.user.id,req.body.displayName))));
  app.put('/api/auth/password',loginLimit,async(req,res)=>{const user=await auth.changePassword(req.user,req.body.currentPassword,req.body.newPassword);auth.login(req,res,user,secure);res.json({ok:true});});
  app.use('/api/users',(req,res,next)=>{store.users.requireAdmin(req.user.id);next();});
  app.get('/api/users',(_,res)=>res.json(store.users.list()));
  const authorize=req=>()=>{if(!auth.user(req))throw fail(401,'请重新登录');store.users.requireAdmin(req.user.id);};
  app.post('/api/users',loginLimit,async(req,res)=>res.status(201).json(store.users.public(await store.users.create(req.body,req.user.id,{authorize:authorize(req)}))));
  app.patch('/api/users/:id',async(req,res)=>res.json(store.users.public(await store.users.update(req.params.id,req.body,req.user.id,authorize(req)))));
  app.put('/api/users/:id/password',loginLimit,async(req,res)=>{const target=store.users.get(req.params.id);if(!target)throw fail(404,'账号不存在');const credentials=await passwordHash(req.body.newPassword);const actor=auth.user(req);if(!actor)throw fail(401,'请重新登录');store.users.requireAdmin(actor.id);const updated=store.users.setPassword(target.id,credentials,target.credentialVersion);if(target.id===actor.id)auth.login(req,res,updated,secure);res.json({ok:true});});
  app.get('/api/status',(req,res)=>res.json({scan:library.getJob(req.user.id),stats:store.stats(req.user.id),sources:store.sources(req.user.id),version:store.libraryVersion(req.user.id)}));
  const authorizedTrash=req=>()=>{if(!auth.user(req))throw fail(401,'请重新登录');};
  app.post('/api/photos/trash',async(req,res)=>res.json(await trash.move(req.user.id,req.body?.ids,authorizedTrash(req))));
  app.get('/api/trash',(req,res)=>res.json(trash.list(req.user.id)));
  app.post('/api/trash/:id/restore',async(req,res)=>res.json(await trash.restore(req.user.id,req.params.id,authorizedTrash(req))));
  app.get('/api/sources',(req,res)=>res.json(store.sources(req.user.id)));
  app.get('/api/directories/native',(req,res)=>res.json({available:nativeLocal(req)&&nativePicker.supported}));
  app.post('/api/directories/native',async(req,res)=>{
    if(!nativeLocal(req))return res.status(403).json({error:'系统文件夹选择仅限这台电脑上的本地访问',code:'NATIVE_LOCAL_ONLY'});
    if(!nativePicker.supported)throw fail(409,'系统文件夹选择不可用，请使用网页选择');
    if(req.body.path!==undefined&&(typeof req.body.path!=='string'||req.body.path.length>32768))throw fail(400,'文件夹路径不正确');
    const controller=new AbortController(),disconnected=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnected);
    try{
      if(res.destroyed||req.aborted)return;
      let initial=req.body.path||req.user.allowedRoots[0]||'';
      if(initial){
        if(!path.isAbsolute(initial))throw fail(400,'文件夹路径不正确');
        const exists=await stat(initial).then(info=>info.isDirectory()).catch(()=>false);
        initial=exists?await store.users.assertSource(req.user.id,initial):'';
      }
      if(controller.signal.aborted)return;
      if(!auth.user(req))throw fail(401,'请重新登录');
      const selected=await nativePicker.pick(initial,{signal:controller.signal});
      if(!auth.user(req))throw fail(401,'请重新登录');
      if(selected===null)return res.json({path:null,canceled:true});
      const full=await store.users.assertSource(req.user.id,selected);
      if(!auth.user(req))throw fail(401,'请重新登录');
      res.json({path:full,canceled:false});
    }finally{res.off('close',disconnected);}
  });
  app.get('/api/directories',async(req,res)=>{
    const listing=await browseDirectories(store,req.user.id,req.query.path);
    if(!auth.user(req))throw fail(401,'请重新登录');
    res.json(listing);
  });
  const validateSource=async (body,userId)=>{
    if(typeof body.path!=='string' || !path.isAbsolute(body.path))throw fail(400,'请填写家中电脑上的完整文件夹路径');
    if(body.recursive!==undefined && typeof body.recursive!=='boolean')throw fail(400,'递归扫描设置不正确');
    const full=await store.users.assertSource(userId,body.path);
    return {name:directoryName(full),path:full,recursive:body.recursive??true,ownerId:userId};
  };
  app.post('/api/sources',async(req,res)=>{
    if(library.job.running)throw fail(409,'扫描进行中，请稍后修改目录');
    const input=await validateSource(req.body,req.user.id);
    if(!auth.user(req))throw fail(401,'请重新登录');
    if(library.job.running)throw fail(409,'扫描进行中，请稍后修改目录');
    store.users.assertNoOverlap([input.path],req.user.id);
    if(store.sources(req.user.id).some(s=>s.path.toLowerCase()===input.path.toLowerCase()))throw fail(409,'这个文件夹已经添加');
    const source=store.addSource(input);void library.scan(req.user.id);res.status(201).json(source);
  });
  app.patch('/api/sources/:id',async(req,res)=>{
    if(library.job.running)throw fail(409,'扫描进行中，请稍后修改目录');
    const source=store.source(req.params.id,req.user.id);if(!source)throw fail(404,'目录不存在');
    const input=await validateSource({...source,...req.body},req.user.id);
    if(!auth.user(req))throw fail(401,'请重新登录');
    if(library.job.running)throw fail(409,'扫描进行中，请稍后修改目录');
    store.users.assertNoOverlap([input.path],req.user.id);
    if(store.sources(req.user.id).some(s=>s.id!==source.id && s.path.toLowerCase()===input.path.toLowerCase()))throw fail(409,'这个文件夹已经添加');
    const result=store.updateSource(source.id,input);void library.scan(req.user.id);res.json(result);
  });
  app.delete('/api/sources/:id',(req,res)=>{if(!store.source(req.params.id,req.user.id))throw fail(404,'目录不存在');if(library.job.running)throw fail(409,'扫描进行中，请稍后修改目录');if(store.db.prepare('SELECT id FROM photo_trash WHERE sourceId=? AND ownerId=? LIMIT 1').get(req.params.id,req.user.id))throw fail(409,'这个来源还有回收记录，请先恢复回收站中的影像，再移除来源');store.removeSource(req.params.id);res.json({ok:true});});
  app.post('/api/scan',(req,res)=>{void library.scan(req.user.id);res.status(202).json(library.getJob(req.user.id));});
  app.get('/api/photo-selection',(req,res)=>{
    if(req.query.source&&!store.source(req.query.source,req.user.id))throw fail(404,'目录不存在');
    const dates={};for(const name of ['from','until'])if(req.query[name]!==undefined){if(typeof req.query[name]!=='string'||!Number.isFinite(Date.parse(req.query[name])))throw fail(400,'月份范围不正确');dates[name]=new Date(req.query[name]).toISOString();}
    res.json({ids:store.photoIds({userId:req.user.id,source:typeof req.query.source==='string'?req.query.source:'',folder:typeof req.query.folder==='string'?req.query.folder:undefined,search:typeof req.query.search==='string'?req.query.search.slice(0,200):'',kind:typeof req.query.kind==='string'?req.query.kind:'',favorite:req.query.favorite==='true',...dates})});
  });
  app.get('/api/photos',(req,res)=>{
    const offset=Math.max(0,Math.min(1e9,parseInt(req.query.offset)||0)),limit=Math.max(1,Math.min(150,parseInt(req.query.limit)||100));
    if(req.query.source&&!store.source(req.query.source,req.user.id))throw fail(404,'目录不存在');
    res.json(store.photos({userId:req.user.id,source:typeof req.query.source==='string'?req.query.source:'',folder:typeof req.query.folder==='string'?req.query.folder:undefined,search:typeof req.query.search==='string'?req.query.search.slice(0,200):'',kind:req.query.kind,favorite:req.query.favorite==='true',offset,limit}));
  });
  app.get('/api/photos/:id',(req,res)=>{
    const photo=store.asset(req.params.id,req.user.id);if(!photo)throw fail(404,'照片不存在');
    res.json({id:photo.id,sourceId:photo.sourceId,sourceName:photo.sourceName,folder:photo.folder,filename:photo.filename,kind:photo.kind,takenAt:photo.takenAt,width:photo.width,height:photo.height,duration:photo.duration,favorite:photo.favorite,available:photo.sourceStatus!=='offline',version:photo.version});
  });
  app.get('/api/folders',(req,res)=>res.json(store.folders(req.user.id)));
  app.patch('/api/photos/:id/favorite',(req,res)=>{if(typeof req.body.favorite!=='boolean')throw fail(400,'收藏状态不正确');if(!store.asset(req.params.id,req.user.id))throw fail(404,'照片不存在');store.setFavorite(req.params.id,req.body.favorite,req.user.id);res.json({ok:true});});
  app.get('/api/media/:id/:variant',async(req,res)=>{
    if(!/^[a-f0-9]{24}$/.test(req.params.id)||!store.asset(req.params.id,req.user.id))throw fail(404,'照片不存在');
    const {file,download}=await media.get(req.params.id,req.params.variant,req.query.quality??playback(req.user.id).videoQuality);
    if(!auth.user(req))throw fail(401,'请重新登录');
    if(!store.asset(req.params.id,req.user.id))throw fail(404,'照片不存在');
    if(download)res.attachment(download);
    // File is already selected by an authenticated asset ID and confined by Media;
    // permit the application's own hidden .data directory, never arbitrary URLs.
    res.sendFile(file,{cacheControl:false,dotfiles:'allow'},error=>{if(error && !res.headersSent){res.status(error.status||500).json({error:'文件读取失败，请检查照片目录'});}});
  });
  app.use('/api',(_,res)=>res.status(404).json({error:'接口不存在'}));
  app.use(express.static(path.join(project,'dist')));
  app.get('/{*path}',(_,res)=>res.sendFile(path.join(project,'dist','index.html')));
  app.use((error,req,res,next)=>{
    if(res.headersSent)return next(error);
    const status=error.status || (['ENOENT','EACCES'].includes(error.code)?503:500);
    if(status>=500)console.error('[Keeplive]',error.message);
    res.status(status).json({error:status===503?'照片暂时不可读取，请检查硬盘连接':status===500?'素材处理失败，请重试或查看启动窗口':error.message});
  });
  return {app,store,library,media,auth,shares,trash,nativePicker,async close(){await nativePicker.close();await library.close();await media.close();store.close();}};
}

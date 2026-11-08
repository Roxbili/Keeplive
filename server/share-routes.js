import { rateLimit } from 'express-rate-limit';
import { localSetup } from './auth.js';

const cookieName=id=>'keeplive_share_'+id;
const cookieToken=(req,id)=>req.headers.cookie?.split(';').map(value=>value.trim()).find(value=>value.startsWith(cookieName(id)+'='))?.slice(cookieName(id).length+1);
export function registerPublicShares(app,{shares,media,secure}){
  app.use(['/s','/api/shared'],(_,res,next)=>{res.set({'Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive','Cache-Control':'private, no-store'});next();});
  app.use('/api/shared',rateLimit({windowMs:15*60*1000,limit:6000,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'浏览请求过多，请稍后再试'}}));
  const accessLimit=rateLimit({windowMs:15*60*1000,limit:60,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'访问尝试过多，请稍后再试'}});
  app.post('/api/shared/:id/access',accessLimit,(req,res)=>{
    const row=shares.authorize(req.params.id,req.body?.token);
    res.cookie(cookieName(row.id),req.body.token,{httpOnly:true,sameSite:'lax',secure:(secure&&!localSetup(req))||req.secure,path:'/api/shared/'+row.id,maxAge:Math.min(30*86400_000,row.expiresAt?row.expiresAt-Date.now():30*86400_000)});
    res.json({ok:true});
  });
  app.get('/api/shared/:id',(req,res)=>{const row=shares.authorize(req.params.id,cookieToken(req,req.params.id));res.json(shares.page(row,Math.max(0,parseInt(req.query.offset)||0),Math.max(1,Math.min(150,parseInt(req.query.limit)||90))));});
  app.get('/api/shared/:id/media/:asset/:variant',async(req,res)=>{
    const token=cookieToken(req,req.params.id),row=shares.authorize(req.params.id,token);shares.asset(row,req.params.asset,req.params.variant);
    const result=await media.get(req.params.asset,req.params.variant,req.query.quality);
    shares.asset(shares.authorize(req.params.id,token),req.params.asset,req.params.variant);
    if(result.download)res.attachment(result.download);
    res.sendFile(result.file,{cacheControl:false,dotfiles:'allow'},error=>{if(error&&!res.headersSent)res.status(error.status||500).json({error:'照片暂时不可读取，请稍后重试'});});
  });
  app.use('/api/shared',(_,res)=>res.status(404).json({error:'分享接口不存在'}));
}
export function registerOwnerShares(app,{shares,publicOrigin}){
  const linked=result=>({...result,link:(publicOrigin?.replace(/\/$/,'')||'')+result.link});
  app.get('/api/shares',(req,res)=>res.json(shares.list(req.user.id)));
  app.post('/api/shares',(req,res)=>res.status(201).json(linked(shares.create(req.user.id,req.body))));
  app.patch('/api/shares/:id',(req,res)=>res.json(shares.update(req.params.id,req.user.id,req.body)));
  app.delete('/api/shares/:id',(req,res)=>{shares.revoke(req.params.id,req.user.id);res.json({ok:true});});
  app.get('/api/shares/:id/link',(req,res)=>{const row=shares.get(req.params.id,req.user.id);if(row.revokedAt)return res.status(410).json({error:'分享已取消'});res.json(linked({link:shares.link(row)}));});
  app.post('/api/shares/:id/rotate',(req,res)=>res.json(linked(shares.rotate(req.params.id,req.user.id))));
}

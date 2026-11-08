import { randomBytes,createHash,scrypt as callback,timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { passwordHash,userError } from './users.js';
const scrypt=promisify(callback),digest=value=>createHash('sha256').update(value).digest('hex');
export function cookieToken(req){return req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith('keeplive='))?.slice(9);}
export function localSetup(req){
  const remote=req.socket.remoteAddress;let hostname;try{hostname=new URL(`http://${req.headers.host}`).hostname;}catch{return false;}
  return ['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote)&&['127.0.0.1','localhost','[::1]'].includes(hostname)&&!['x-forwarded-for','x-forwarded-host','x-forwarded-proto','forwarded','tailscale-user-login'].some(h=>req.headers[h]!==undefined);
}
export class Auth {
  constructor(store){this.store=store;}
  user(req){const token=cookieToken(req);if(!token)return null;
    const session=this.store.db.prepare('SELECT s.userId FROM sessions s JOIN users u ON u.id=s.userId WHERE token=? AND expires>? AND u.active=1 AND s.version=u.credentialVersion').get(digest(token),Date.now());
    return session?this.store.users.get(session.userId):null;
  }
  loggedIn(req){return !!this.user(req);}
  async verify(user,password){if(!user||typeof password!=='string'||password.length>128)return false;
    const hash=await scrypt(password,user.salt,64);return timingSafeEqual(hash,Buffer.from(user.hash,'hex'));
  }
  async authenticate(username,password){
    const user=this.store.users.find(username);
    // A dummy derivation keeps unknown usernames on the same password verification path.
    const valid=await this.verify(user??{salt:'keeplive-unknown',hash:'00'.repeat(64)},password);
    const fresh=user&&this.store.users.get(user.id);
    return valid&&fresh?.active&&fresh.credentialVersion===user.credentialVersion?fresh:null;
  }
  login(req,res,user,secure=false){
    const fresh=this.store.users.get(user.id);if(!fresh?.active||fresh.credentialVersion!==user.credentialVersion)throw userError(401,'账号状态已变化，请重新登录');
    const previous=cookieToken(req);if(previous)this.store.db.prepare('DELETE FROM sessions WHERE token=?').run(digest(previous));this.store.db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());
    const token=randomBytes(32).toString('hex'),seconds=30*86400;
    this.store.db.prepare('INSERT INTO sessions(token,expires,userId,version) VALUES (?,?,?,?)').run(digest(token),Date.now()+seconds*1000,user.id,user.credentialVersion);
    res.cookie('keeplive',token,{httpOnly:true,sameSite:'lax',secure:(secure&&!localSetup(req))||req.secure,maxAge:seconds*1000,path:'/'});
  }
  async changePassword(user,currentPassword,newPassword){
    if(!await this.verify(user,currentPassword))throw userError(401,'当前密码不正确');
    const credentials=await passwordHash(newPassword);return this.store.users.setPassword(user.id,credentials,user.credentialVersion);
  }
  logout(req,res,secure=false){const token=cookieToken(req);if(token)this.store.db.prepare('DELETE FROM sessions WHERE token=?').run(digest(token));res.clearCookie('keeplive',{httpOnly:true,sameSite:'lax',secure:(secure&&!localSetup(req))||req.secure,path:'/'});}
}

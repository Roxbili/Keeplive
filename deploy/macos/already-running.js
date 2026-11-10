// Exit 0 only for an already-running Keeplive; 1 means the launcher can start it.
try{process.loadEnvFile('.env');}catch(error){
  if(error.code!=='ENOENT'){console.error('无法读取 .env：',error.message);process.exit(2);}
}
const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT)||3210;
const localHost=host==='0.0.0.0'?'127.0.0.1':host==='::'?'::1':host;
const address=`http://${localHost.includes(':')?`[${localHost}]`:localHost}:${port}`;
try{
  const response=await fetch(address+'/api/auth/status',{signal:AbortSignal.timeout(1500),redirect:'error'});
  const status=await response.json();
  if(response.ok&&typeof status.setup==='boolean'&&typeof status.authenticated==='boolean'&&typeof status.setupAllowed==='boolean'){
    console.log(`Keeplive 已在运行：${address}`);process.exit(0);
  }
}catch{/* A stopped service is the ordinary first-launch case. */}
process.exit(1);

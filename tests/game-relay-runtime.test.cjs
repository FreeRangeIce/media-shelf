// Native workerd via Miniflare. Mocked outbound services only; no browser/live network.
// MINIFLARE_MODULE may point at an installed Miniflare module, never a credential.
const {Miniflare,Response:MFResponse}=require(process.env.MINIFLARE_MODULE || 'miniflare');
const fs=require('node:fs'),path=require('node:path');
const modulePath=process.env.GAME_WORKER_MODULE || path.join(__dirname,'../relay/game-worker.js');
const compat=process.env.WORKER_COMPAT_DATE || '2026-08-06';
let pass=0,fail=0;
const ck=(name,ok)=>{console.log((ok?'PASS ':'FAIL ')+name);ok?pass++:fail++;};
async function scenario(redirectKind){
 const calls=[];
 const mf=new Miniflare({rootPath:path.dirname(modulePath),modules:true,script:fs.readFileSync(modulePath,'utf8'),compatibilityDate:compat,bindings:{ALLOWED_ORIGINS:'https://shelf.invalid',IGDB_APP_DAILY_CAP:'500',TWITCH_CLIENT_ID:'dummy-client',TWITCH_CLIENT_SECRET:'dummy-secret'},kvNamespaces:['GAME_LIMITS'],durableObjects:{GAME_COORDINATOR:{className:'GameCoordinator',useSQLite:true}},outboundService:async req=>{
  const url=new URL(req.url),kind=url.hostname==='id.twitch.tv'?'token':url.hostname==='api.igdb.com'?'game':'unexpected';
  calls.push(kind);
  if(kind==='unexpected')throw Error('unexpected external host');
  if(kind===redirectKind)return new MFResponse(null,{status:302,headers:{Location:'https://not-approved.invalid/redirect'}});
  return new MFResponse(JSON.stringify(kind==='token'?{access_token:'dummy-token-123',expires_in:3600}:[{id:42,name:'Hades'}]),{headers:{'Content-Type':'application/json'}});
 }});
 try {
  await mf.ready;
  const response=await mf.dispatchFetch('https://relay.invalid/game/search?title=Hades',{headers:{Origin:'https://shelf.invalid','CF-Connecting-IP':'1.2.3.4'}});
  const body=await response.json();
  if(!redirectKind){ck('native Worker reaches mocked Twitch and IGDB',response.status===200&&calls.join(',')==='token,game');ck('native Worker returns selected-match candidates',body.candidates?.[0]?.igdbId==='42');}
  else {ck(`native ${redirectKind} redirect rejected`,response.status===502&&body.error==='provider_redirect_rejected');ck(`native ${redirectKind} redirect never follows unapproved host`,calls.join(',')===(redirectKind==='token'?'token':'token,game'));}
 } finally {await mf.dispose();}
}
(async()=>{console.log('Native compatibility date:',compat);for(const kind of [null,'token','game'])await scenario(kind);console.log(`${pass}/${pass+fail} passed`);process.exitCode=fail?1:0;})().catch(e=>{console.error(e);process.exitCode=1;});

// FCM relay. Keep credentials in Script Properties, never in the Android APK or a public repository.
// Add only: if (order.action === 'waslPush') return waslPushApi_(order); to the existing doPost.
const WASL_PUSH_GATEWAY_='https://enchanted-ostrich-60.eu-west-1.convex.site';
function waslPushJson_(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);}
function waslPushHex_(bytes){return bytes.map(b=>('0'+((b+256)%256).toString(16)).slice(-2)).join('');}
function waslPushHash_(value){return waslPushHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,value,Utilities.Charset.UTF_8));}
function waslPushEqual_(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function waslPushProps_(){return PropertiesService.getScriptProperties();}
function waslPushApi_(r){try{
 if(r.operation==='configure')return waslPushJson_(waslPushConfigure_(r));
 if(r.operation==='register')return waslPushJson_(waslPushRegister_(r));
 if(r.operation!=='send')return waslPushJson_({ok:false,error:'invalid_operation'});
 const props=waslPushProps_(),secret=props.getProperty('WASL_PUSH_RELAY_SECRET');
 if(!secret||!props.getProperty('WASL_PUSH_SERVICE_ACCOUNT'))return waslPushJson_({ok:false,error:'not_configured'});
 const ts=Number(r.ts),nonce=String(r.nonce||''),payload=r.payload,signature=String(r.signature||'');
 if(!Number.isSafeInteger(ts)||Math.abs(Date.now()/1000-ts)>300||!/^[a-f0-9]{32}$/i.test(nonce)||typeof payload!=='string'||payload.length>50000||!/^[a-f0-9]{64}$/i.test(signature))return waslPushJson_({ok:false,error:'invalid_request'});
 const expected=waslPushHex_(Utilities.computeHmacSha256Signature(ts+'\n'+nonce+'\n'+payload,secret,Utilities.Charset.UTF_8));
 if(!waslPushEqual_(expected,signature.toLowerCase()))return waslPushJson_({ok:false,error:'unauthorized'});
 const lock=LockService.getScriptLock();if(!lock.tryLock(5000))return waslPushJson_({ok:false,error:'busy',retryAfter:15});
 const cache=CacheService.getScriptCache();try{if(cache.get('push-nonce:'+nonce))return waslPushJson_({ok:false,error:'replay'});cache.put('push-nonce:'+nonce,'1',600);}finally{lock.releaseLock();}
 const data=JSON.parse(payload),note=data.notification;
 if(!Array.isArray(data.targets)||data.targets.length>20||!data.targets.every(h=>typeof h==='string'&&/^[a-f0-9]{64}$/.test(h))||!note||!/^\d{1,16}$/.test(String(note.id))||typeof note.title!=='string'||note.title.length>200||typeof note.body!=='string'||note.body.length>800)return waslPushJson_({ok:false,error:'invalid_payload'});
 return waslPushJson_(waslPushSend_(data.targets,note));
 }catch(e){return waslPushJson_({ok:false,error:'relay_error',retryAfter:60});}}
function waslPushRegister_(r){
 const token=String(r.deviceToken||''),fcm=String(r.fcmToken||'');if(!/^[a-f0-9]{64}$/i.test(token)||fcm.length<20||fcm.length>4096||/\s/.test(fcm))return {ok:false,error:'invalid_registration'};
 const response=UrlFetchApp.fetch(WASL_PUSH_GATEWAY_+'/api/integrations/devices/health',{method:'get',headers:{Authorization:'Bearer '+token},followRedirects:false,muteHttpExceptions:true});
 if(response.getResponseCode()!==200)return {ok:false,error:'unauthorized'};const health=JSON.parse(response.getContentText());if(!health.ok||health.scope!=='postal')return {ok:false,error:'wrong_scope'};
 const props=waslPushProps_();if(!props.getProperty('WASL_PUSH_SERVICE_ACCOUNT'))return {ok:false,error:'not_configured'};
 const hash=waslPushHash_(token.toLowerCase()),lock=LockService.getScriptLock();if(!lock.tryLock(5000))return {ok:false,error:'busy'};
 try{const all=props.getProperties(),prefix='WASL_PUSH_DEVICE_',keys=Object.keys(all).filter(k=>k.indexOf(prefix)===0);if(!all[prefix+hash]&&keys.length>=40)return {ok:false,error:'registration_limit'};
  props.setProperty(prefix+hash,JSON.stringify({fcmToken:fcm,registeredAt:Date.now()}));
 }finally{lock.releaseLock();}return {ok:true};
}
function waslPushConfigure_(r){
 // This function is available only during an owner-authenticated deployment setup.
 // The temporary bootstrap function is removed from the live project immediately after setup.
 if(typeof waslPushBootstrap_!=='function')return {ok:false,error:'setup_unavailable'};
 const setup=waslPushBootstrap_(),key=String(r.setupKey||'');if(!setup||Date.now()>setup.until||!key||!waslPushEqual_(waslPushHash_(key),setup.hash))return {ok:false,error:'unauthorized'};
 const c=r.config,sa=c&&c.serviceAccount;if(!c||!/^[a-f0-9]{64}$/.test(c.relaySecret||'')||!sa||sa.project_id!=='wasl-orders-ahmed-20261017'||sa.client_email!=='wasl-push@'+sa.project_id+'.iam.gserviceaccount.com'||!String(sa.private_key||'').includes('BEGIN PRIVATE KEY'))return {ok:false,error:'invalid_config'};
 const props=waslPushProps_(),lock=LockService.getScriptLock();if(!lock.tryLock(5000))return {ok:false,error:'busy'};
 try{if(props.getProperty('WASL_PUSH_BOOTSTRAP_USED')===setup.hash)return {ok:false,error:'setup_used'};props.setProperty('WASL_PUSH_RELAY_SECRET',c.relaySecret);props.setProperty('WASL_PUSH_SERVICE_ACCOUNT',JSON.stringify(sa));props.setProperty('WASL_PUSH_BOOTSTRAP_USED',setup.hash);}finally{lock.releaseLock();}
 return {ok:true,project:sa.project_id};
}
function waslPushAccessToken_(){
 const sa=JSON.parse(waslPushProps_().getProperty('WASL_PUSH_SERVICE_ACCOUNT')||'null');if(!sa||!sa.private_key||!sa.client_email)throw Error('not_configured');
 const cache=CacheService.getScriptCache(),key='push-oauth:'+sa.private_key_id,old=cache.get(key);if(old)return {value:old,project:sa.project_id};
 const at=Math.floor(Date.now()/1000),base=value=>Utilities.base64EncodeWebSafe(typeof value==='string'?value:JSON.stringify(value)).replace(/=+$/,'');
 const input=base({alg:'RS256',typ:'JWT'})+'.'+base({iss:sa.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:at,exp:at+3600});
 const signed=Utilities.computeRsaSha256Signature(input,sa.private_key),jwt=input+'.'+Utilities.base64EncodeWebSafe(signed).replace(/=+$/,'');
 const response=UrlFetchApp.fetch('https://oauth2.googleapis.com/token',{method:'post',payload:{grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:jwt},followRedirects:false,muteHttpExceptions:true});
 if(response.getResponseCode()!==200)throw Error('push_auth_failed');const token=JSON.parse(response.getContentText());if(!token.access_token)throw Error('push_auth_failed');cache.put(key,token.access_token,Math.min(3500,Number(token.expires_in)||3500));return {value:token.access_token,project:sa.project_id};
}
function waslPushSend_(targets,note){
 const props=waslPushProps_(),cache=CacheService.getScriptCache(),unique=[...new Set(targets)],pending=[];let skipped=0,sent=0,failed=0,retryAfter=0;
 unique.forEach(hash=>{const raw=props.getProperty('WASL_PUSH_DEVICE_'+hash);if(!raw||cache.get('push-sent:'+hash+':'+note.id)){skipped++;return;}const d=JSON.parse(raw);pending.push({hash,fcmToken:d.fcmToken});});if(!pending.length)return {ok:true,sent:0,skipped};
 const token=waslPushAccessToken_();if(!/^[a-z][a-z0-9-]{4,40}$/.test(token.project))throw Error('invalid_project');
 pending.forEach(device=>{
  const response=UrlFetchApp.fetch('https://fcm.googleapis.com/v1/projects/'+token.project+'/messages:send',{method:'post',contentType:'application/json',headers:{Authorization:'Bearer '+token.value},payload:JSON.stringify({message:{token:device.fcmToken,data:{id:String(note.id),title:note.title,body:note.body},android:{priority:'HIGH',ttl:'86400s'}}}),followRedirects:false,muteHttpExceptions:true});
  const code=response.getResponseCode();if(code===200){cache.put('push-sent:'+device.hash+':'+note.id,'1',21600);sent++;return;}
  let error;try{error=JSON.parse(response.getContentText()).error;}catch(e){}
  if(code===404&&error&&Array.isArray(error.details)&&error.details.some(d=>d.errorCode==='UNREGISTERED')){props.deleteProperty('WASL_PUSH_DEVICE_'+device.hash);skipped++;return;}
  if(code===429||code>=500){failed++;const headers=response.getAllHeaders(),value=headers['Retry-After']||headers['retry-after'];let seconds=Number(value);if(!Number.isFinite(seconds))seconds=Math.ceil((Date.parse(String(value))-Date.now())/1000);retryAfter=Math.max(retryAfter,Number.isFinite(seconds)?Math.min(3600,Math.max(1,seconds)):60);return;}
  // Permanent configuration/target errors do not enter an endless retry loop.
  failed++;
 });return {ok:failed===0,sent,skipped,failed,...(retryAfter?{retryAfter}:{}),...(failed&&!retryAfter?{permanent:true}:{})};
}

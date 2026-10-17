import {scanPaid} from './scanner.js';
let running=false;
function originOf(value){const url=new URL(value);if(url.protocol!=='https:'||!/^[-a-z0-9]+\.macaly\.app$/i.test(url.hostname)||url.username||url.password)throw Error('اكتب رابط تطبيق وصل المنشور على macaly.app');return url.origin;}
export async function collect(){
 if(running)throw Error('القراءة شغالة بالفعل');running=true;
 try{
  const settings=await chrome.storage.local.get(['origin','token']);const origin=originOf(settings.origin);if(!settings.token)throw Error('اربط الأداة برمز الاقتران من وصل أولًا');
  const tabs=await chrome.tabs.query({url:'https://web.whatsapp.com/*'});if(tabs.length!==1)throw Error('افتح تبويب WhatsApp Web واحدًا، واختار Paid');
  const result=await chrome.scripting.executeScript({target:{tabId:tabs[0].id},func:scanPaid});const data=result[0]?.result;if(!data)throw Error('تعذرت قراءة القائمة');
  const response=await fetch(origin+'/api/integrations/devices/paid',{method:'POST',headers:{Authorization:'Bearer '+settings.token,'Content-Type':'application/json'},body:JSON.stringify({...data,eventId:crypto.randomUUID()})});let reply;try{reply=await response.json();}catch{throw Error('المنصة لم تُرجع تأكيدًا. لم نعتبر العملية ناجحة.');}
  if(!response.ok||reply.ok!==true)throw Error(reply?.error||'لم تقبل المنصة الربط');
  const text=`وصلت ${data.phones.length} أرقام. ${data.unresolved} أسماء بدون رقم. `+(reply.applied?`تأكد ${reply.applied} طلب.`:'راجع المطابقة في التطبيق.');await chrome.storage.local.set({lastStatus:text,lastAt:new Date().toISOString()});return {ok:true,message:text};
 }catch(error){const message=String(error.message||error);await chrome.storage.local.set({lastStatus:message,lastAt:new Date().toISOString()});return {ok:false,message};}finally{running=false;}
}
chrome.runtime.onMessage.addListener((message,_sender,respond)=>{if(message.type==='collect'){collect().then(respond);return true;}if(message.type==='schedule'){chrome.storage.local.get('interval').then(async s=>{await chrome.alarms.clear('wasl-paid');if(Number(s.interval)>=1)await chrome.alarms.create('wasl-paid',{periodInMinutes:Number(s.interval)*60});respond({ok:true});});return true;}});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='wasl-paid')void collect();});

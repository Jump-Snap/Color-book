// Optional Wasl integration. Existing orders and Telegram continue if this is not configured.
// Never put WASL_SYNC_SECRET or a bot token into index.html or a public repository.
const WASL_EXTRA_COLUMNS = { tracking: 23, shippedAt: 24, deliveredAt: 25, carrierStatus: 26, collected: 27 };

// Current Macaly release pulls signed snapshots from Convex on a configurable schedule.
// This setup leaves the landing page endpoint, Telegram and sheet columns unchanged.
function configureWaslReadOnlyBridge() {
  const props=PropertiesService.getScriptProperties();
  const secret=props.getProperty('WASL_SYNC_SECRET') || Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,'');
  props.setProperty('WASL_SYNC_SECRET',secret);
  SpreadsheetApp.getUi().alert('مفتاح قراءة الشيت لوصل',secret+'\n\nانسخه في إعدادات وصل مع رابط /exec الحالي. اختار الجدولة من وصل. لا تنشر المفتاح ولا ترسله في تليجرام.',SpreadsheetApp.getUi().ButtonSet.OK);
}

function configureWaslBridge() {
  const ui = SpreadsheetApp.getUi();
  const answer = ui.prompt('ربط وصل', 'رابط استقبال الشيت من صفحة الربط في تطبيق وصل (https://…macaly.app/api/integrations/sheets/events)', ui.ButtonSet.OK_CANCEL);
  if (answer.getSelectedButton() !== ui.Button.OK) return;
  const url = answer.getResponseText().trim();
  if (!/^https:\/\/[a-z0-9-]+\.macaly\.app\/api\/integrations\/sheets\/events$/.test(url)) throw new Error('Use the exact HTTPS Macaly webhook URL');
  const props = PropertiesService.getScriptProperties();
  const secret = props.getProperty('WASL_SYNC_SECRET') || Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  waslEnsureColumns_();
  props.setProperties({ WASL_WEBHOOK_URL: url, WASL_SYNC_SECRET: secret, WASL_DIRTY: '1' });
  if (!ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'flushWaslSync')) ScriptApp.newTrigger('flushWaslSync').timeBased().everyMinutes(5).create();
  // Show only to the person running setup. Do not log the secret or send it through Telegram.
  ui.alert('مفتاح الربط — انسخه في صفحة الربط الخاصة بوصل', secret + '\n\nلا تضعه في اللاندنج بيدج. لم تتغير إعدادات البوت أو رابط الأوردرات.', ui.ButtonSet.OK);
}

function waslEnsureColumns_() {
  const sheet = ordersSheet_();
  if (sheet.getMaxColumns() < 27) sheet.insertColumnsAfter(sheet.getMaxColumns(), 27 - sheet.getMaxColumns());
  const headers=[['رقم الشحنة',23],['وقت الشحن',24],['وقت التسليم',25],['آخر حالة من البريد',26],['التحصيل المودع',27]];
  headers.forEach(pair => {
    const cell=sheet.getRange(1,pair[1]);
    if (cell.getValue() && String(cell.getValue()) !== pair[0]) throw new Error('Column '+pair[1]+' is already used; stop and review before configuring');
  });
  headers.forEach(pair=>{const cell=sheet.getRange(1,pair[1]);if(!cell.getValue())cell.setValue(pair[0]);});
  sheet.getRange('W:W').setNumberFormat('@');
  sheet.getRange('X:Y').setNumberFormat('yyyy-mm-dd hh:mm');
}

function waslMarkDirty_() {
  try{const props=PropertiesService.getScriptProperties();
    if (!props.getProperty('WASL_WEBHOOK_URL')) return;
    props.setProperties({WASL_DIRTY:'1',WASL_REVISION:String(Number(props.getProperty('WASL_REVISION')||0)+1)});
  }catch(error){console.error('Wasl change marker failed; keep original order and Telegram flow running');}
}

function waslHex_(bytes) {return bytes.map(b=>('0'+(b&255).toString(16)).slice(-2)).join('');}
function waslSign_(secret,envelope) {return waslHex_(Utilities.computeHmacSha256Signature([envelope.ts,envelope.nonce,envelope.operation,envelope.payload].join('\n'),secret));}
function waslEqual_(a,b) {if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0;}
function waslEnvelope_(operation,payload,secret) {const e={action:'wasl',operation:operation,ts:Math.floor(Date.now()/1000),nonce:Utilities.getUuid().replace(/-/g,''),payload:JSON.stringify(payload)};e.signature=waslSign_(secret,e);return e;}
function waslCheckEnvelope_(e) {
  const secret=PropertiesService.getScriptProperties().getProperty('WASL_SYNC_SECRET');
  if (!secret || !e || !Number.isFinite(Number(e.ts)) || Math.abs(Date.now()/1000-Number(e.ts))>300 || !/^[a-zA-Z0-9_-]{20,100}$/.test(e.nonce||'') || typeof e.payload!=='string' || e.payload.length>2000000 || !['ping','snapshot','update'].includes(e.operation)) throw new Error('Unauthorized Wasl request');
  if(!waslEqual_(waslSign_(secret,e),e.signature))throw new Error('Invalid Wasl signature');
  const cache=CacheService.getScriptCache(),key='wasl-nonce-'+e.nonce;if(cache.get(key))throw new Error('Replayed Wasl request');cache.put(key,'1',600);
  return JSON.parse(e.payload);
}
function waslISO_(value) {return value instanceof Date&&!isNaN(value.getTime())?value.toISOString():null;}
function waslPhone_(value){let p=String(value||'').replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[۰-۹]/g,c=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(c)).replace(/[\s()+.-]/g,'');if(p.startsWith('00'))p=p.slice(2);if(/^01[0125]\d{8}$/.test(p))p='20'+p.slice(1);if(/^1[0125]\d{8}$/.test(p))p='20'+p;return /^201[0125]\d{8}$/.test(p)?'+'+p:null;}
function waslMapRow_(r) {
  const statusMap={'جديد':'new','تم التأكيد':'confirmed','مؤكد':'confirmed','تم الشحن':'shipped','تم التوصيل':'delivered','تم التسليم':'delivered','مرتجع':'returned','ملغي':'cancelled'};
  const o={code:String(r[15]||''),name:String(r[0]||''),phone:normalizePhone_(r[1]),address:String(r[2]||''),governorate:String(r[3]||''),product:String(r[4]||''),amount:parseAmount_(r[10])||parseAmount_(r[5]),notes:String(r[6]||''),childName:String(r[9]||''),telegramMessageId:String(r[16]||''),status:r[17]?statusMap[String(r[17])]||'unknown':'new',rawStatus:String(r[17]||''),paidAmount:parseAmount_(r[18]),remainingAmount:parseAmount_(r[19]),confirmedAt:waslISO_(r[20]),createdAt:waslISO_(r[21]),tracking:String(r[22]||''),shippedAt:waslISO_(r[23]),deliveredAt:waslISO_(r[24]),carrierStatus:String(r[25]||''),collectedAmount:parseAmount_(r[26]),source:'google-sheets'};
  o.rawPhone=String(r[1]||'');o.phone=waslPhone_(r[1]);o.currency=/د\.ك|KWD/i.test(String(r[5]||''))?'KWD':'EGP';
  o.sourceVersion=waslHex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,JSON.stringify(o)));
  return o;
}
function waslSnapshot_() {
  const sheet=ordersSheet_(),last=sheet.getLastRow();if(last>5001)throw new Error('Sheet is larger than 5000 orders; configure paginated sync before continuing');
  const width=Math.min(27,sheet.getMaxColumns());
  const orders=last<2?[]:sheet.getRange(2,1,last-1,width).getValues().filter(r=>r[0]&&r[15]).map(waslMapRow_);
  return {source:'google-sheets',revision:Number(PropertiesService.getScriptProperties().getProperty('WASL_REVISION')||0),orders:orders,generatedAt:new Date().toISOString()};
}
function waslApi_(envelope) {
  try {
    const payload=waslCheckEnvelope_(envelope);
    if(envelope.operation==='ping')return waslJSON_({ok:true,protocol:1,source:'google-sheets'});
    const lock=LockService.getScriptLock();lock.waitLock(30000);
    try {
      if(envelope.operation==='snapshot')return waslJSON_({ok:true,...waslSnapshot_()});
      return waslJSON_(waslUpdate_(payload));
    }finally{lock.releaseLock();}
  }catch(error){return waslJSON_({ok:false,error:String(error.message||'Sync failed')});}
}
function waslUpdate_(p) {
  const id=validOrderId_(p.code);if(!id)throw new Error('Invalid order ID');
  const sheet=ordersSheet_(),row=findRowByValue_(sheet,ORDER_COLUMNS.orderId,id);if(!row)throw new Error('Order not found');
  waslEnsureColumns_();const current=waslMapRow_(sheet.getRange(row,1,1,27).getValues()[0]);
  if(!p.sourceVersion||p.sourceVersion!==current.sourceVersion) return {ok:false,conflict:true,error:'Order changed in Sheets or Telegram; refresh before retrying'};
  const next=String(p.status||current.status),allowed={new:['new','confirmed'],confirmed:['confirmed','shipped'],shipped:['shipped','delivered'],delivered:['delivered']};
  if(!allowed[current.status]||!allowed[current.status].includes(next))throw new Error('Invalid status transition');
  const tracking=String(p.tracking===undefined?current.tracking:p.tracking).trim().toUpperCase();
  if(tracking&&!/^[A-Z]{2}\d{9}EG$/.test(tracking))throw new Error('Invalid Egypt Post tracking code');
  if(next==='shipped'&&!tracking)throw new Error('Tracking number required before shipping');
  if(tracking){const duplicates=waslSnapshot_().orders.filter(o=>o.code!==id&&o.tracking===tracking);if(duplicates.length)throw new Error('Tracking number belongs to another order');}
  if(p.collectedAmount!==undefined&&(!Number.isFinite(Number(p.collectedAmount))||Number(p.collectedAmount)<0||next!=='delivered'))throw new Error('Invalid collection amount');
  const statusMap={new:'جديد',confirmed:'تم التأكيد',shipped:'تم الشحن',delivered:'تم التوصيل'};
  sheet.getRange(row,ORDER_COLUMNS.status).setValue(statusMap[next]);
  if(next!==current.status){const col=next==='confirmed'?21:next==='shipped'?24:25;if(!sheet.getRange(row,col).getValue())sheet.getRange(row,col).setValue(new Date());}
  sheet.getRange(row,WASL_EXTRA_COLUMNS.tracking).setNumberFormat('@').setValue(tracking);
  if(p.carrierStatus!==undefined)sheet.getRange(row,WASL_EXTRA_COLUMNS.carrierStatus).setValue(safeCell_(String(p.carrierStatus).slice(0,300)));
  if(p.collectedAmount!==undefined){const amount=Number(p.collectedAmount);if(!Number.isFinite(amount)||amount<0||next!=='delivered')throw new Error('Invalid collection amount');sheet.getRange(row,WASL_EXTRA_COLUMNS.collected).setValue(amount);}
  syncOrderStage_(row);syncShippingQueue_(row);waslMarkDirty_();
  try{refreshTelegramKeyboard_(row);if(next!==current.status)notifyTelegramStatus_(row);}catch(error){console.error('Wasl status saved; Telegram notification needs retry: '+String(error.message));}
  return {ok:true,order:waslMapRow_(sheet.getRange(row,1,1,27).getValues()[0])};
}
function flushWaslSync() {
  const props=PropertiesService.getScriptProperties(),url=props.getProperty('WASL_WEBHOOK_URL'),secret=props.getProperty('WASL_SYNC_SECRET');
  if(!url||!secret||props.getProperty('WASL_DIRTY')!=='1')return;
  const lock=LockService.getScriptLock();if(!lock.tryLock(1000))return;
  try {
    const snapshot=waslSnapshot_(),envelope=waslEnvelope_('snapshot',snapshot,secret);
    const response=UrlFetchApp.fetch(url,{method:'post',contentType:'application/json',payload:JSON.stringify(envelope),muteHttpExceptions:true,followRedirects:false});
    let reply;try{reply=JSON.parse(response.getContentText());}catch{throw new Error('Wasl did not return JSON');}
    if(response.getResponseCode()!==200||reply.ok!==true||reply.revision!==snapshot.revision)throw new Error('Wasl did not acknowledge this revision');
    props.setProperties({WASL_DIRTY:'0',WASL_LAST_SUCCESS:new Date().toISOString(),WASL_LAST_ERROR:''});
  }catch(error){props.setProperty('WASL_LAST_ERROR',String(error.message).slice(0,300));console.error('Wasl sync will retry; existing orders and Telegram remain unchanged');}
  finally{lock.releaseLock();}
}
function waslJSON_(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}

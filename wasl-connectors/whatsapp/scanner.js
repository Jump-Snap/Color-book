// Self-contained: Chrome serializes this function into the WhatsApp tab's isolated world.
export async function scanPaid(){
 function phone(s){let p=String(s).replace(/[٠-٩]/g,c=>'٠١٢٣٤٥٦٧٨٩'.indexOf(c)).replace(/[\s()+.-]/g,'');if(p.startsWith('00'))p=p.slice(2);if(/^01[0125]\d{8}$/.test(p))p='20'+p.slice(1);if(/^1[0125]\d{8}$/.test(p))p='20'+p;return /^201[0125]\d{8}$/.test(p)?'+'+p:null;}
 function paidActive(){return [...document.querySelectorAll('button[aria-pressed="true"],[role="tab"][aria-selected="true"]')].some(e=>/^paid$/i.test((e.textContent||'').trim()))||[...document.querySelectorAll('input[placeholder],[data-placeholder]')].some(e=>/search in paid|بحث.*في.*paid/i.test(e.getAttribute('placeholder')||e.getAttribute('data-placeholder')||''));}
 if(!paidActive())throw Error('افتح قائمة Paid أولًا. لن نقرأ قائمة كل العملاء.');
 const panel=document.querySelector('#pane-side');if(!panel)throw Error('قائمة المحادثات غير متاحة. افتح WhatsApp Web وسجل الدخول.');
 const scroller=[panel,...panel.querySelectorAll('div')].filter(e=>e.scrollHeight>e.clientHeight+40&&e.clientHeight>150).sort((a,b)=>b.clientHeight-a.clientHeight)[0];
 const original=scroller?.scrollTop||0,numbers=new Set(),unresolved=new Set();let scanned=0,complete=false;
 try{
  if(scroller)scroller.scrollTop=0;
  for(let pass=0;pass<300;pass++){
   await new Promise(r=>setTimeout(r,350));if(!paidActive())throw Error('تغير تصنيف واتساب أثناء القراءة. لم تُرسل البيانات.');
   const rows=[...panel.querySelectorAll('[role="row"]')];if(!rows.length)throw Error('شكل قائمة واتساب غير مدعوم في النسخة الحالية. استخدم سكرين Paid للمراجعة.');
   for(const row of rows){const title=row.querySelector('[title]')?.getAttribute('title')||'';const direct=phone(title);const jid=(row.getAttribute('data-id')||'').match(/(?:^|_)(20\d{10})@c\.us(?:_|$)/);const number=direct||(jid&&phone(jid[1]));if(number)numbers.add(number);else if(title)unresolved.add(title);}
   scanned=Math.max(scanned,numbers.size+unresolved.size);
   if(!scroller||scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-5){complete=true;break;}
   const prev=scroller.scrollTop;scroller.scrollTop+=Math.max(200,scroller.clientHeight*.8);if(scroller.scrollTop===prev){complete=false;break;}
  }
 }finally{if(scroller)scroller.scrollTop=original;}
 if(!numbers.size)throw Error('لم تظهر أرقام موبايل. افتح بيانات جهات الاتصال المحفوظة أو استخدم سكرين القائمة.');
 return {phones:[...numbers],unresolved:unresolved.size,loaded:scanned,complete,observedAt:new Date().toISOString(),source:'whatsapp-web-paid'};
}

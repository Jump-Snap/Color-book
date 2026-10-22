package app.wasl.companion;

import android.Manifest;
import android.app.Activity;
import android.content.*;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.os.Bundle;
import android.provider.Telephony;
import android.view.View;
import android.widget.*;
import org.json.*;
import org.xmlpull.v1.XmlPullParser;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Postal messages only, local preview first; no inbox upload or default-SMS role. */
public class PostalHistoryActivity extends Activity {
 private TextView status,preview;private int previewPage;private static final int PAGE_SIZE=50;private JSONArray events=new JSONArray();private volatile boolean busy;
 @Override public void onCreate(Bundle state){super.onCreate(state);LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);int p=AppUi.dp(this,20);body.setPadding(p,p,p,p);
  TextView title=new TextView(this);title.setText("رسائل البريد القديمة");title.setTextSize(25);body.addView(title);
  TextView info=new TextView(this);info.setText("اسمح بقراءة SMS مرة واحدة لعرض رسائل EGYPT POST فقط على جهازك، ثم راجعها قبل الإرسال. أندرويد يمنح إذن قراءة الرسائل عمومًا، لكن وصل يختار رسائل البريد ذات كود شحنة فقط. لا يطلب إرسال رسائل أو تغيير تطبيق SMS الافتراضي.");info.setTextSize(17);body.addView(info);
  AppUi.button(this,body,"اقرأ رسائل البريد القديمة من الموبايل",this::requestRead);
  AppUi.button(this,body,"أو اختار ملف رسائل XML",()->{if(busy)return;Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");i.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"text/xml","application/xml","text/plain"});try{startActivityForResult(i,907);}catch(Exception e){status.setText("تعذر فتح اختيار الملفات");}});
  AppUi.button(this,body,"ربط الهاتف تلقائيًا بدون أكواد",()->startActivity(new Intent(this,OrdersActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("pair",true)));
  status=new TextView(this);status.setTextSize(17);body.addView(status);
  AppUi.button(this,body,"إرسال المعاينة إلى وصل",this::send);
  preview=new TextView(this);preview.setTextSize(16);preview.setTextIsSelectable(true);body.addView(preview);
  AppUi.button(this,body,"الرسائل السابقة",()->{if(previewPage>0){previewPage--;show();}});
  AppUi.button(this,body,"الرسائل التالية",()->{if((previewPage+1)*PAGE_SIZE<events.length()){previewPage++;show();}});
  AppUi.button(this,body,"رجوع",this::finish);ScrollView scroll=new ScrollView(this);scroll.addView(body);AppUi.install(this,scroll);
  try{android.util.AtomicFile f=historyFile();if(f.getBaseFile().exists())events=new JSONArray(new String(f.readFully(),StandardCharsets.UTF_8));else events=new JSONArray(SyncClient.prefs(this).getString("postalHistoryPreview","[]"));}catch(Exception ignored){}show();
 }
 static String digits(String text){StringBuilder s=new StringBuilder();for(char c:text.toCharArray()){if(c>='٠'&&c<='٩')s.append((char)('0'+c-'٠'));else if(c>='۰'&&c<='۹')s.append((char)('0'+c-'۰'));else if(c!='\u200e'&&c!='\u200f')s.append(c);}return s.toString();}
 private static final java.util.regex.Pattern TRACKING_CODE=java.util.regex.Pattern.compile("(?i)(?<![A-Z0-9])[A-Z]{2}\\s*(?:[0-9OIL]\\s*){9}EG(?![A-Z0-9])");
 static boolean postal(String sender,String body){return sender!=null&&sender.replaceAll("[\\s_-]","").matches("(?i)EGYPTPOST|البريدالمصري")&&body!=null&&TRACKING_CODE.matcher(digits(java.text.Normalizer.normalize(body,java.text.Normalizer.Form.NFKC)).replaceAll("[\\u200B-\\u200F\\u202A-\\u202E\\u2066-\\u2069\\uFEFF]","")).find();}
 private JSONObject event(String sender,String body,long at)throws Exception {String text=digits(body);if(text.length()>5000||at<=0||at>System.currentTimeMillis())throw new Exception("تاريخ أو طول رسالة غير صالح");byte[] hash=MessageDigest.getInstance("SHA-256").digest((sender.trim().toUpperCase(Locale.ROOT)+"\n"+text+"\n"+at).getBytes(StandardCharsets.UTF_8));StringBuilder key=new StringBuilder("sms-history:");for(byte b:hash)key.append(String.format(Locale.ROOT,"%02x",b&255));return new JSONObject().put("eventId",key.toString()).put("sender",sender).put("text",text).put("receivedAt",java.time.Instant.ofEpochMilli(at).toString()).put("source","android-sms-history");}
 private void requestRead(){if(busy)return;if(checkSelfPermission(Manifest.permission.READ_SMS)==PackageManager.PERMISSION_GRANTED){readSms();return;}SyncClient.prefs(this).edit().putBoolean("smsReadAsked",true).apply();requestPermissions(new String[]{Manifest.permission.READ_SMS},906);}
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==906){if(results.length>0&&results[0]==PackageManager.PERMISSION_GRANTED)readSms();else status.setText("أندرويد لم يسمح بقراءة SMS. تقدر تختار ملف XML من نسخة الرسائل بدلًا من ذلك. لا يلزم هذا الإذن لاستخدام باقي وصل.");}}
 private void readSms(){busy=true;status.setText("قراءة رسائل البريد على جهازك…");new Thread(()->{try{JSONArray found=new JSONArray();int skipped=0;Set<String> unique=new HashSet<>();
   try(Cursor c=getContentResolver().query(Telephony.Sms.Inbox.CONTENT_URI,new String[]{Telephony.Sms.ADDRESS,Telephony.Sms.BODY,Telephony.Sms.DATE},"address LIKE ? OR address LIKE ?",new String[]{"%EGYPT%POST%","%البريد%المصري%"},Telephony.Sms.DATE+" DESC")){
    if(c==null)throw new Exception("لم نستطع فتح رسائل البريد");while(c.moveToNext()){String sender=c.getString(0),body=c.getString(1);if(!postal(sender,body))continue;try{JSONObject e=event(sender,body,c.getLong(2));if(unique.add(e.getString("eventId"))){found.put(e);if(found.length()%200==0){int total=found.length();runOnUiThread(()->status.setText("قراءة تاريخ البريد كاملًا… "+total+" رسالة"));}}}catch(Exception ignored){skipped++;}}
   }
   int held=skipped;save(found,"اتقرأت "+found.length()+" رسالة بريد. راجع النص والتاريخ قبل الإرسال."+(held>0?" توجد رسائل بتواريخ أو بيانات غير صالحة لم تدخل المعاينة.":""));
  }catch(SecurityException e){runOnUiThread(()->status.setText("إذن SMS مقيّد على هذا الجهاز. استخدم اختيار ملف XML؛ لم تُرسل أي رسالة."));}catch(Exception e){runOnUiThread(()->status.setText("تعذرت قراءة الرسائل. استخدم ملف XML أو راجع الإذن."));}finally{busy=false;}}).start();}
 private android.util.AtomicFile historyFile(){return new android.util.AtomicFile(new File(getFilesDir(),"postal-history.json"));}
 private synchronized void persist(JSONArray data)throws IOException {android.util.AtomicFile file=historyFile();FileOutputStream out=null;try{out=file.startWrite();out.write(data.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(out);SyncClient.prefs(this).edit().remove("postalHistoryPreview").apply();}catch(IOException e){if(out!=null)file.failWrite(out);throw e;}}
 private void save(JSONArray found,String message)throws IOException {persist(found);events=found;previewPage=0;runOnUiThread(()->{show();status.setText(message);});}
 private void show(){int count=events.length();previewPage=Math.max(0,Math.min(previewPage,Math.max(0,(count-1)/PAGE_SIZE)));status.setText(count+" رسالة بريد في المعاينة. لن تُرسل قبل ضغط إرسال. تظهر للمراجعة في رسائل البريد داخل وصل، أو يُحدّث المطابق إذا اخترت الوضع التلقائي.");StringBuilder text=new StringBuilder();int start=previewPage*PAGE_SIZE,end=Math.min(start+PAGE_SIZE,count);if(count>0)text.append("عرض ").append(start+1).append(" — ").append(end).append(" من ").append(count).append("\n\n");for(int i=start;i<end;i++){JSONObject e=events.optJSONObject(i);if(e!=null)text.append(e.optString("receivedAt")).append("\n").append(e.optString("text")).append("\n\n");}preview.setText(text);}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=907||result!=RESULT_OK||data==null||data.getData()==null||busy)return;busy=true;status.setText("قراءة ملف الرسائل…");new Thread(()->{try(InputStream input=getContentResolver().openInputStream(data.getData())){if(input==null)throw new IOException();ByteArrayOutputStream out=new ByteArrayOutputStream();byte[] chunk=new byte[8192];int n;while((n=input.read(chunk))!=-1){out.write(chunk,0,n);if(out.size()>50*1024*1024)throw new IOException();}
   String xml=new String(out.toByteArray(),StandardCharsets.UTF_8);if(java.util.regex.Pattern.compile("(?i)<!DOCTYPE|<!ENTITY").matcher(xml).find())throw new IOException();XmlPullParser parser=android.util.Xml.newPullParser();parser.setFeature(XmlPullParser.FEATURE_PROCESS_NAMESPACES,false);parser.setInput(new StringReader(xml));JSONArray found=new JSONArray();Set<String> unique=new HashSet<>();int count=0;
   for(int kind=parser.getEventType();kind!=XmlPullParser.END_DOCUMENT;kind=parser.next()){if(kind==XmlPullParser.DOCDECL)throw new IOException();if(kind!=XmlPullParser.START_TAG||!"sms".equals(parser.getName()))continue;String sender=parser.getAttributeValue(null,"address"),body=parser.getAttributeValue(null,"body");String smsType=parser.getAttributeValue(null,"type");if(smsType!=null&&!"1".equals(smsType))continue;if(!postal(sender,body))continue;JSONObject e=event(sender,body,Long.parseLong(parser.getAttributeValue(null,"date")));if(unique.add(e.getString("eventId"))){count++;found.put(e);}}
   save(found,"اتقرأت "+found.length()+" رسالة بريد من الملف. راجعها ثم أرسلها.");
  }catch(Exception e){runOnUiThread(()->status.setText("الملف غير صالح أو يتجاوز 50 ميجا. اختار ملف XML أصغر؛ لم نستورد جزءًا من الملف."));}finally{busy=false;}}).start();}
 private void send(){if(busy)return;if(events.length()==0){status.setText("اقرأ رسائل البريد أو اختار ملفًا أولًا");return;}String token=SyncClient.prefs(this).getString("token","");if(token.isEmpty()){status.setText("اضغط ربط الهاتف تلقائيًا أولًا؛ لا تحتاج نسخ كود");return;}busy=true;status.setText("إرسال الرسائل لوصل…");JSONArray sending=events;new Thread(()->{try{int saved=0,applied=0;for(int i=0;i<sending.length();i+=50){JSONArray batch=new JSONArray();Set<String> expected=new HashSet<>();int end=Math.min(i+50,sending.length());for(int j=i;j<end;j++){JSONObject e=sending.getJSONObject(j);batch.put(e);expected.add(e.getString("eventId"));}JSONObject reply=SyncClient.request(NativePairing.GATEWAY,token,"/api/integrations/devices/postal",new JSONObject().put("events",batch));JSONArray ack=reply.optJSONArray("acknowledged");if(ack!=null)for(int j=0;j<ack.length();j++)expected.remove(ack.getString(j));if(!expected.isEmpty())throw new IOException();saved+=batch.length();applied+=reply.optInt("applied",0);
    JSONArray remaining=new JSONArray();for(int j=end;j<sending.length();j++)remaining.put(sending.getJSONObject(j));persist(remaining);events=remaining;int done=saved,total=sending.length();runOnUiThread(()->status.setText("اترسلت "+done+" من "+total+" رسالة؛ التقدم محفوظ للاستكمال"));}
   int count=saved,changes=applied;runOnUiThread(()->{show();status.setText("اتحفظت "+count+" رسالة في وصل. اتحدّث "+changes+" طلب مطابق تلقائيًا. افتح رسائل البريد في وصل لمراجعة الباقي؛ الرسائل غير المطابقة محفوظة للمراجعة.");});
  }catch(Exception e){runOnUiThread(()->{show();status.setText("الإرسال لم يكتمل. المتبقي محفوظ؛ اضغط إرسال للاستكمال بدون تكرار الرسائل المحفوظة.");});}finally{busy=false;}}).start();}

}

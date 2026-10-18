package app.wasl.companion;
import android.content.Context;
import android.content.SharedPreferences;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Notification;
import android.os.Build;
import android.Manifest;
import android.content.pm.PackageManager;
import org.json.JSONArray;
import org.json.JSONObject;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.HashSet;
import java.util.Set;

public final class SyncClient {
 private static final Object QUEUE_LOCK=new Object();
 public static SharedPreferences prefs(Context c){return c.getSharedPreferences("wasl",Context.MODE_PRIVATE);}
 public static String origin(String input)throws Exception{URL u=new URL(input.trim());if(!u.getProtocol().equals("https")||!u.getHost().matches("[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)?\\.convex\\.site")||u.getUserInfo()!=null||u.getPort()!=-1||u.getQuery()!=null||u.getRef()!=null||!(u.getPath().isEmpty()||u.getPath().equals("/")))throw new Exception("انسخ رابط بوابة الأجهزة من إعدادات وصل");return "https://"+u.getHost();}
 public static void enqueue(Context c,JSONObject event)throws Exception{
  synchronized(QUEUE_LOCK){SharedPreferences p=prefs(c);JSONArray q=new JSONArray(p.getString("queue","[]"));for(int i=0;i<q.length();i++)if(q.getJSONObject(i).optString("eventId").equals(event.getString("eventId")))return;
   if(q.length()>=500){p.edit().putString("lastStatus","وصل صندوق الانتظار إلى 500 رسالة. افتح التطبيق للمزامنة؛ لم نحذف الرسائل القديمة.").apply();return;}
   q.put(event);p.edit().putString("queue",q.toString()).apply();}
 }
 public static JSONObject request(String base,String token,String path,JSONObject body)throws Exception{
  HttpsURLConnection connection=(HttpsURLConnection)new URL(origin(base)+path).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(20000);connection.setRequestProperty("Authorization","Bearer "+token);connection.setRequestProperty("Accept","application/json");
  try{if(body!=null){connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");try(var out=connection.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
   int code=connection.getResponseCode();if(code!=200)throw new Exception("تعذر الاتصال أو رمز الاقتران غير صالح ("+code+")");String response;try(var in=connection.getInputStream()){java.io.ByteArrayOutputStream bytes=new java.io.ByteArrayOutputStream();byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1){bytes.write(buffer,0,n);if(bytes.size()>2000000)throw new Exception("Response too large");}response=bytes.toString("UTF-8");}JSONObject json=new JSONObject(response);if(!json.optBoolean("ok"))throw new Exception(json.optString("error","المنصة لم تؤكد الاستلام"));return json;
  }finally{connection.disconnect();}
 }
 public static boolean sync(Context c){
  SharedPreferences p=prefs(c);String base=p.getString("origin",""),token=p.getString("token","");if(base.isEmpty()||token.isEmpty())return false;
  try{JSONArray batch=new JSONArray();synchronized(QUEUE_LOCK){JSONArray q=new JSONArray(p.getString("queue","[]"));for(int i=0;i<Math.min(50,q.length());i++)batch.put(q.getJSONObject(i));}
   if(batch.length()>0){JSONObject reply=request(base,token,"/api/integrations/devices/postal",new JSONObject().put("events",batch));JSONArray acknowledged=reply.optJSONArray("acknowledged");if(acknowledged==null)throw new Exception("لم تصل إيصالات حفظ الرسائل");Set<String> ids=new HashSet<>();for(int i=0;i<acknowledged.length();i++)ids.add(acknowledged.getString(i));
    synchronized(QUEUE_LOCK){JSONArray q=new JSONArray(p.getString("queue","[]")),remaining=new JSONArray();for(int i=0;i<q.length();i++)if(!ids.contains(q.getJSONObject(i).optString("eventId")))remaining.put(q.getJSONObject(i));p.edit().putString("queue",remaining.toString()).apply();}}
   boolean canNotify=Build.VERSION.SDK_INT<33||c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED;
   NotificationManager manager=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);
   if(canNotify){manager.createNotificationChannel(new NotificationChannel("wasl-delays","متابعة تأخير الطلبات",NotificationManager.IMPORTANCE_DEFAULT));canNotify=manager.areNotificationsEnabled()&&manager.getNotificationChannel("wasl-delays").getImportance()!=NotificationManager.IMPORTANCE_NONE;}
   if(canNotify)for(int page=0;page<10;page++){
    JSONObject alerts=request(base,token,"/api/integrations/devices/alerts?cursor="+java.net.URLEncoder.encode(p.getString("alertsCursor","0"),"UTF-8"),null);
    JSONArray list=alerts.optJSONArray("alerts");if(list==null||list.length()>50)throw new Exception("قائمة تنبيهات غير صالحة");
    for(int i=0;i<list.length();i++){JSONObject a=list.getJSONObject(i);PushClient.display(c,a.getString("id"),a.optString("title","وصل — طلبات تحتاج متابعة"),a.optString("body"));}
    String next=alerts.getString("cursor");if(!next.matches("[0-9]+"))throw new Exception("مؤشر تنبيهات غير صالح");p.edit().putString("alertsCursor",next).apply();if(!alerts.optBoolean("hasMore"))break;
   }
   p.edit().putString("lastStatus","تم الاتصال والمزامنة بنجاح").putLong("lastSync",System.currentTimeMillis()).apply();return true;
  }catch(Exception error){p.edit().putString("lastStatus",error.getMessage()==null?"تعذرت المزامنة. الرسائل محفوظة للمحاولة القادمة.":error.getMessage()).apply();return false;}
 }
}

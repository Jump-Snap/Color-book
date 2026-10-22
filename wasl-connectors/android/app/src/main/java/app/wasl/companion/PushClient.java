package app.wasl.companion;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import org.json.JSONObject;
import java.net.URL;
import javax.net.ssl.HttpsURLConnection;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** No FCM enrollment until the user enables notifications and pairs this phone. */
final class PushClient {
 private static final Object LOCK=new Object();
 static boolean initialize(Context context){
  if(!FirebaseApp.getApps(context).isEmpty())return true;
  String project=context.getString(R.string.wasl_firebase_project_id);
  if(project.isEmpty()||context.getString(R.string.wasl_firebase_app_id).isEmpty())return false;
  FirebaseOptions options=new FirebaseOptions.Builder().setProjectId(project).setApplicationId(context.getString(R.string.wasl_firebase_app_id)).setGcmSenderId(context.getString(R.string.wasl_firebase_sender_id)).setApiKey(context.getString(R.string.wasl_firebase_api_key)).build();FirebaseApp.initializeApp(context,options);return true;
 }
 static void enable(Context context){Context c=context.getApplicationContext();SyncClient.prefs(c).edit().putBoolean("pushOptIn",true).apply();if(!initialize(c)){SyncClient.prefs(c).edit().putString("pushStatus","خدمة Firebase لم تُجهّز في هذه النسخة بعد").apply();return;}FirebaseMessaging.getInstance().setAutoInitEnabled(true);FirebaseMessaging.getInstance().getToken().addOnSuccessListener(t->register(c,t)).addOnFailureListener(e->SyncClient.prefs(c).edit().putString("pushStatus","تعذر تسجيل التنبيهات؛ افتح الإنترنت وحاول مرة أخرى").apply());}
 static void register(Context c,String fcmToken){if(!SyncClient.prefs(c).getBoolean("pushOptIn",false))return;String token=SyncClient.prefs(c).getString("token","");if(token.isEmpty()){SyncClient.prefs(c).edit().putString("pushStatus","اربط الهاتف أولًا").apply();return;}
  new Thread(()->{try{SyncClient.request(NativePairing.GATEWAY,token,"/api/integrations/devices/fcm",new JSONObject().put("fcmToken",fcmToken));SyncClient.prefs(c).edit().putString("fcmToken",fcmToken).putString("pushStatus","تم تسجيل التنبيهات السحابية لهذا الهاتف").apply();}catch(Exception error){SyncClient.prefs(c).edit().putString("pushStatus","لم يكتمل تسجيل التنبيهات؛ افتح الإنترنت وأعد التفعيل").apply();}},"wasl-fcm-register").start();
 }
 static void display(Context c,String id,String title,String body){synchronized(LOCK){
  if(id==null||id.length()>160||title==null||body==null)return;if(Build.VERSION.SDK_INT>=33&&c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;NotificationManager manager=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);manager.createNotificationChannel(new NotificationChannel("wasl-delays","متابعة تأخير الطلبات",NotificationManager.IMPORTANCE_DEFAULT));if(!manager.areNotificationsEnabled()||manager.getNotificationChannel("wasl-delays").getImportance()==NotificationManager.IMPORTANCE_NONE)return;
  Set<String> old=SyncClient.prefs(c).getStringSet("deliveredAlerts",Collections.emptySet());if(old.contains(id))return;LinkedHashSet<String> seen=new LinkedHashSet<>(old);seen.add(id);while(seen.size()>500)seen.remove(seen.iterator().next());
  Intent open=new Intent(c,OrdersActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);PendingIntent pending=PendingIntent.getActivity(c,id.hashCode(),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
  manager.notify(id.hashCode(),new Notification.Builder(c,"wasl-delays").setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title.substring(0,Math.min(title.length(),200))).setContentText(body.substring(0,Math.min(body.length(),800))).setContentIntent(pending).setAutoCancel(true).build());SyncClient.prefs(c).edit().putStringSet("deliveredAlerts",seen).apply();
 }}
}

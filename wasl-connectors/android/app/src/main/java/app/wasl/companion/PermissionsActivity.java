package app.wasl.companion;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.*;
import android.provider.Settings;
import android.view.View;
import android.widget.*;

/** One tap per permission; Android owns the final grant screen. */
public class PermissionsActivity extends Activity {
 private TextView states;private boolean guiding,notificationPending;private String waiting="";
 @Override public void onCreate(Bundle saved){super.onCreate(saved);if(saved!=null){guiding=saved.getBoolean("guiding");waiting=saved.getString("waiting","");notificationPending=saved.getBoolean("notificationPending");}
  LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);int p=AppUi.dp(this,20);body.setPadding(p,p,p,p);
  TextView title=new TextView(this);title.setText("تشغيل وصل على الموبايل");title.setTextSize(25);body.addView(title);
  TextView info=new TextView(this);info.setText("اضغط الإذن المطلوب ووافق في شاشة أندرويد. وصل يقرأ إشعارات البريد فقط من تطبيق الرسائل بعد سماحك. الربط من حسابك في وصل بدون نسخ أكواد.");info.setTextSize(17);body.addView(info);
  states=new TextView(this);states.setTextSize(17);states.setPadding(0,p,0,p);body.addView(states);
  AppUi.button(this,body,"تفعيل الأذونات المطلوبة بالترتيب",()->{guiding=true;next();});
  AppUi.button(this,body,"السماح بتنبيهات الطلبات",()->single("notifications"));
  AppUi.button(this,body,"السماح بقراءة إشعارات البريد",()->single("postal"));
  AppUi.button(this,body,"قراءة رسائل البريد القديمة",()->startActivity(new Intent(this,PostalHistoryActivity.class)));
  AppUi.button(this,body,"الإذن مقفول؟ افتح حل سامسونج",this::restrictedHelp);
  AppUi.button(this,body,"ربط الهاتف بحسابي بدون أكواد",()->startActivity(new Intent(this,OrdersActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("pair",true)));
  TextView camera=new TextView(this);camera.setText("الكاميرا والملفات جاهزة عبر تطبيقات النظام عند رفع البوليصة. إذن الرسائل القديمة اختياري، ويُطلب فقط عند ضغط قراءة الرسائل.");camera.setTextSize(16);body.addView(camera);
  AppUi.button(this,body,"رجوع",this::finish);ScrollView scroll=new ScrollView(this);scroll.addView(body);AppUi.install(this,scroll);show();
 }
 static boolean postalEnabled(Context c){ComponentName wanted=new ComponentName(c,PostalListener.class);if(Build.VERSION.SDK_INT>=27)return ((NotificationManager)c.getSystemService(NOTIFICATION_SERVICE)).isNotificationListenerAccessGranted(wanted);String enabled=Settings.Secure.getString(c.getContentResolver(),"enabled_notification_listeners");if(enabled!=null)for(String item:enabled.split(":"))if(wanted.equals(ComponentName.unflattenFromString(item)))return true;return false;}
 private boolean notificationsEnabled(){NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);NotificationChannel channel=manager.getNotificationChannel("wasl-delays");return manager.areNotificationsEnabled()&&(channel==null||channel.getImportance()!=NotificationManager.IMPORTANCE_NONE)&&(Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED);}
 private String label(boolean on){return on?"مفعّل ✓":"اضغط زر السماح بالأسفل";}
 private void show(){if(states!=null)states.setText("تنبيهات الطلبات: "+label(notificationsEnabled())+"\nإشعارات البريد: "+label(postalEnabled(this))+"\nربط الحساب: "+(SyncClient.prefs(this).getString("token","").isEmpty()?"اضغط ربط الهاتف بحسابي":"محفوظ على هذا الجهاز")+"\nالتنبيهات السحابية: "+SyncClient.prefs(this).getString("pushStatus","لم تُفعّل بعد"));}
 private void single(String kind){guiding=false;request(kind);}
 private void next(){if(notificationsEnabled())PushClient.enable(this);show();if(!guiding)return;if(!notificationsEnabled())request("notifications");else if(!postalEnabled(this))request("postal");else {guiding=false;Toast.makeText(this,"الأذونات مفعّلة",Toast.LENGTH_LONG).show();}}
 private void request(String kind){waiting=kind;
  if("notifications".equals(kind)){
   if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED&&(!SyncClient.prefs(this).getBoolean("notificationAsked",false)||shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))){SyncClient.prefs(this).edit().putBoolean("notificationAsked",true).apply();notificationPending=true;requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},905);return;}
   NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);NotificationChannel channel=manager.getNotificationChannel("wasl-delays");if(manager.areNotificationsEnabled()&&channel!=null&&channel.getImportance()==NotificationManager.IMPORTANCE_NONE)open(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,"wasl-delays"));else open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));
  }else if("postal".equals(kind)){if(Build.VERSION.SDK_INT>=30)open(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,new ComponentName(this,PostalListener.class).flattenToString()));else open(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));}
  else open(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
 }
 private void open(Intent i){try{startActivity(i);}catch(ActivityNotFoundException e){guiding=false;waiting="";Toast.makeText(this,"افتح الإذن من إعدادات الموبايل",Toast.LENGTH_LONG).show();}}
 private void after(){String kind=waiting;waiting="";show();boolean granted="notifications".equals(kind)?notificationsEnabled():"postal".equals(kind)?postalEnabled(this):false;if(granted){if("notifications".equals(kind))PushClient.enable(this);if(guiding)next();}else {guiding=false;Toast.makeText(this,"الإذن لم يُفعّل. لو مقفول اضغط «الإذن مقفول؟»",Toast.LENGTH_LONG).show();}}
 private void restrictedHelp(){guiding=false;new AlertDialog.Builder(this).setTitle("تفعيل الإعدادات المقيّدة").setMessage("أندرويد يمنع التطبيق من تفعيل هذا بنفسه.\n\nافتح معلومات التطبيق ← الثلاث نقط ← السماح بالإعدادات المقيّدة إن ظهر الخيار. ثم ارجع واضغط إذن البريد.\n\nالإذن يسمح بقراءة إشعارات التطبيقات؛ فعّله فقط للنسخة التي تثق بها.").setPositiveButton("فتح معلومات وصل",(d,w)->{waiting="";open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())));}).setNegativeButton("رجوع",null).show();}
 @Override protected void onResume(){super.onResume();show();if(!waiting.isEmpty()&&!notificationPending)after();}
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==905){notificationPending=false;after();}}
 @Override protected void onSaveInstanceState(Bundle b){super.onSaveInstanceState(b);b.putBoolean("guiding",guiding);b.putString("waiting",waiting);b.putBoolean("notificationPending",notificationPending);}
}

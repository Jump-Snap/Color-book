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

/** Special access always stays under the user's control in Android settings. */
public class PermissionsActivity extends Activity {
 private TextView states;private boolean guiding,waitingSettings,notificationPending;
 @Override public void onCreate(Bundle saved){super.onCreate(saved);
  if(saved!=null){guiding=saved.getBoolean("guiding");waitingSettings=saved.getBoolean("waitingSettings");notificationPending=saved.getBoolean("notificationPending");}
  LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);int p=AppUi.dp(this,20);body.setPadding(p,p,p,p);
  TextView title=new TextView(this);title.setText("تجهيز أذونات وصل");title.setTextSize(25);body.addView(title);
  TextView info=new TextView(this);info.setText("فعّل الأذونات التي تحتاجها فقط. سنفتح كل خطوة ونراجع حالتها عند رجوعك. يمكنك تأجيل أي خطوة واستخدام الطلبات وتصوير البوالص.");info.setTextSize(17);body.addView(info);
  states=new TextView(this);states.setTextSize(17);states.setPadding(0,p,0,p);body.addView(states);
  AppUi.button(this,body,"ابدأ تجهيز الأذونات خطوة بخطوة",()->{guiding=true;next();});
  AppUi.button(this,body,"إذن تنبيهات الطلبات",this::notifications);
  AppUi.button(this,body,"إذن قراءة إشعارات البريد",this::postal);
  AppUi.button(this,body,"إذن قراءة قائمة Paid في واتساب",this::paid);
  AppUi.button(this,body,"حل رسالة الإعدادات المقيّدة",this::restrictedHelp);
  TextView camera=new TextView(this);camera.setText("الكاميرا والملفات: يتم الاختيار عبر كاميرا الموبايل ومنتقي الملفات عند رفع البوليصة؛ لا نطلب وصولًا لكل الصور أو سجل الرسائل أو جهات الاتصال.");camera.setTextSize(16);body.addView(camera);
  AppUi.button(this,body,"إعداد ربط واتساب",()->startActivity(new Intent(this,PaidActivity.class)));
  AppUi.button(this,body,"إعداد ربط البريد",()->startActivity(new Intent(this,MainActivity.class)));
  AppUi.button(this,body,"رجوع للطلبات",this::finish);
  ScrollView scroll=new ScrollView(this);scroll.addView(body);AppUi.install(this,scroll);show();
 }
 static boolean paidEnabled(Context c){String enabled=Settings.Secure.getString(c.getContentResolver(),Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);if(enabled==null)return false;ComponentName wanted=new ComponentName(c,PaidReader.class);for(String item:enabled.split(":"))if(wanted.equals(ComponentName.unflattenFromString(item)))return true;return false;}
 static boolean postalEnabled(Context c){ComponentName wanted=new ComponentName(c,PostalListener.class);if(Build.VERSION.SDK_INT>=27)return ((NotificationManager)c.getSystemService(NOTIFICATION_SERVICE)).isNotificationListenerAccessGranted(wanted);String enabled=Settings.Secure.getString(c.getContentResolver(),"enabled_notification_listeners");if(enabled!=null)for(String item:enabled.split(":"))if(wanted.equals(ComponentName.unflattenFromString(item)))return true;return false;}
 private boolean notificationsEnabled(){NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);NotificationChannel channel=manager.getNotificationChannel("wasl-delays");return manager.areNotificationsEnabled()&&(channel==null||channel.getImportance()!=NotificationManager.IMPORTANCE_NONE)&&(Build.VERSION.SDK_INT<33||checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)==PackageManager.PERMISSION_GRANTED);}
 private void show(){if(states!=null)states.setText("تنبيهات الطلبات: "+label(notificationsEnabled())+"\nقراءة إشعارات البريد: "+label(postalEnabled(this))+"\nقراءة Paid في واتساب: "+label(paidEnabled(this))+"\n\nالاقتران برمز واتساب والبريد خطوة منفصلة عن الأذونات.");}
 private String label(boolean on){return on?"مفعّل ✓":"غير مفعّل";}
 private void next(){show();if(!guiding)return;
  if(!notificationsEnabled()){explain("تنبيهات الطلبات","اسمح لوصل بعرض تنبيهات المتابعة على هذا الجهاز.",this::notifications);return;}
  if(!postalEnabled(this)){explain("قراءة إشعارات البريد","أندرويد يمنح الإذن للوصول إلى الإشعارات. وصل يعالج فقط إشعارات البريد المصري الجديدة الواردة من تطبيقات الرسائل المدعومة.",this::postal);return;}
  if(!paidEnabled(this)){explain("قراءة شاشة واتساب بيزنس","إذن إمكانية الوصول يسمح بقراءة محتوى الشاشة. خدمة وصل مقيّدة بواتساب بيزنس، وتجمع أرقام Paid الظاهرة فقط في جلسة تبدأها أنت لمدة 5 دقائق.",this::paid);return;}
  guiding=false;new AlertDialog.Builder(this).setTitle("الأذونات مفعّلة").setMessage("راجع ربط واتساب والبريد بالرموز الخاصة بهما، ثم ابدأ الاستخدام.").setPositiveButton("تمام",null).show();
 }
 private void explain(String title,String message,Runnable action){new AlertDialog.Builder(this).setTitle(title).setMessage(message).setPositiveButton("فتح طلب الإذن",(d,w)->action.run()).setNegativeButton("لاحقًا",(d,w)->guiding=false).setOnCancelListener(d->guiding=false).show();}
 private void notifications(){
  if(Build.VERSION.SDK_INT>=33&&checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED&&(!SyncClient.prefs(this).getBoolean("notificationAsked",false)||shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))){SyncClient.prefs(this).edit().putBoolean("notificationAsked",true).apply();notificationPending=true;requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},905);}
  else {NotificationManager manager=(NotificationManager)getSystemService(NOTIFICATION_SERVICE);NotificationChannel channel=manager.getNotificationChannel("wasl-delays");if(manager.areNotificationsEnabled()&&channel!=null&&channel.getImportance()==NotificationManager.IMPORTANCE_NONE)open(new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()).putExtra(Settings.EXTRA_CHANNEL_ID,"wasl-delays"));else open(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE,getPackageName()));}
 }
 private void postal(){if(Build.VERSION.SDK_INT>=30)open(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_DETAIL_SETTINGS).putExtra(Settings.EXTRA_NOTIFICATION_LISTENER_COMPONENT_NAME,new ComponentName(this,PostalListener.class).flattenToString()));else open(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS));}
 private void paid(){open(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));}
 private void open(Intent i){waitingSettings=true;try{startActivity(i);}catch(ActivityNotFoundException e){try{startActivity(new Intent(Settings.ACTION_SETTINGS));}catch(Exception ignored){waitingSettings=false;guiding=false;Toast.makeText(this,"افتح إعدادات الموبايل يدويًا",Toast.LENGTH_LONG).show();}}}
 private void restrictedHelp(){guiding=false;new AlertDialog.Builder(this).setTitle("لو ظهر Controlled by restricted setting").setMessage("أندرويد قد يقيّد أذونات التطبيق المثبّت بملف APK. لا يمكن لوصل تفعيلها تلقائيًا.\n\nمن معلومات التطبيق افتح الثلاث نقط، ثم السماح بالإعدادات المقيّدة إن ظهر الخيار. بعدها ارجع هنا لتفعيل قراءة Paid أو إشعارات البريد.\n\nهذا يسمح بمنح وصول حساس لمحتوى الشاشة والإشعارات؛ راجع الإذن وفعّله فقط إذا كنت تثق في النسخة.").setPositiveButton("فتح معلومات التطبيق",(d,w)->open(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName())))).setNegativeButton("رجوع",null).show();}
 @Override protected void onResume(){super.onResume();show();if(waitingSettings&&!notificationPending){waitingSettings=false;afterRequest();}}
 private void afterRequest(){show();if(!guiding)return;new AlertDialog.Builder(this).setTitle("راجع حالة الإذن").setMessage(states.getText()).setPositiveButton("متابعة الخطوات",(d,w)->next()).setNeutralButton("حل الإعدادات المقيّدة",(d,w)->restrictedHelp()).setNegativeButton("أكمل لاحقًا",(d,w)->guiding=false).setOnCancelListener(d->guiding=false).show();}
 @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] results){super.onRequestPermissionsResult(request,permissions,results);if(request==905){notificationPending=false;afterRequest();}}
 @Override protected void onSaveInstanceState(Bundle b){super.onSaveInstanceState(b);b.putBoolean("guiding",guiding);b.putBoolean("waitingSettings",waitingSettings);b.putBoolean("notificationPending",notificationPending);}
}

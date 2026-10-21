package app.wasl.companion;
import android.app.Activity;
import android.app.job.JobInfo;
import android.app.job.JobScheduler;
import android.content.ComponentName;
import android.content.Intent;
import android.os.Bundle;
import android.provider.Settings;
import android.widget.*;
import android.view.View;
import android.text.InputType;
import android.Manifest;
import org.json.JSONObject;

public class MainActivity extends Activity {
 private EditText url,token;private TextView status;private Spinner interval;private final int[] minutes={0,15,30,60,180};
 @Override public void onCreate(Bundle saved){super.onCreate(saved);LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(32,48,32,32);body.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);ScrollView scroll=new ScrollView(this);scroll.addView(body);AppUi.install(this,scroll);
  TextView title=new TextView(this);title.setText("وصل — ربط البريد المصري");title.setTextSize(24);body.addView(title);
  TextView info=new TextView(this);info.setText("الأداة تقرأ إشعارات EGYPT POST الجديدة من تطبيق الرسائل فقط بعد منح الإذن. تقدر تستورد سجل الرسائل القديم من الزر بالأسفل. لو الإنترنت فصل، الرسائل تفضل في الانتظار. لازم تراجع الربط أول مرة من منصة وصل.");info.setPadding(0,20,0,20);body.addView(info);
  button(body,"الأذونات وحل مشاكل الوصول",()->startActivity(new Intent(this,PermissionsActivity.class)));
  button(body,"فتح الطلبات وتصوير البوالص",()->startActivity(new Intent(this,OrdersActivity.class)));
  button(body,"ربط هذا الهاتف تلقائيًا بدون أكواد",()->startActivity(new Intent(this,OrdersActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP).putExtra("pair",true)));
  button(body,"قراءة رسائل البريد القديمة",()->startActivity(new Intent(this,PostalHistoryActivity.class)));
  Switch live=new Switch(this);live.setText("إرسال إشعارات البريد الجديدة فورًا مع الإنترنت");live.setChecked(SyncClient.prefs(this).getBoolean("livePostal",true));live.setOnCheckedChangeListener((v,on)->SyncClient.prefs(this).edit().putBoolean("livePostal",on).apply());body.addView(live);
  url=new EditText(this);url.setHint("بوابة الأجهزة: https://…supabase.co");url.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);url.setText(SyncClient.prefs(this).getString("origin","https://suokxziofqqsqcnncepc.supabase.co"));url.setVisibility(View.GONE);body.addView(url);
  token=new EditText(this);token.setHint("رمز اقتران أندرويد من وصل");token.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);token.setText(SyncClient.prefs(this).getString("token",""));token.setVisibility(View.GONE);body.addView(token);
  interval=new Spinner(this);interval.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"لما أطلب فقط","كل 15 دقيقة","كل 30 دقيقة","كل ساعة","كل 3 ساعات"}));int current=SyncClient.prefs(this).getInt("minutes",15);for(int i=0;i<minutes.length;i++)if(current==minutes[i])interval.setSelection(i);body.addView(interval);
  button(body,"حفظ موعد المزامنة",()->pair());button(body,"منح إذن قراءة إشعارات البريد",()->startActivity(new Intent(this,PermissionsActivity.class)));button(body,"السماح بتنبيهات متابعة الطلبات",()->startActivity(new Intent(this,PermissionsActivity.class)));
  button(body,"مزامنة الآن",()->{status.setText("جاري المزامنة…");new Thread(()->{SyncClient.sync(this);runOnUiThread(this::showStatus);}).start();});status=new TextView(this);status.setPadding(0,24,0,0);body.addView(status);showStatus();
 }
 private void button(LinearLayout view,String text,Runnable action){AppUi.button(this,view,text,action);}
 private void showStatus(){String pending=SyncClient.prefs(this).getString("queue","[]");int count=0;try{count=new org.json.JSONArray(pending).length();}catch(Exception ignored){}status.setText(SyncClient.prefs(this).getString("lastStatus","لم يتم الاقتران بعد")+"\nرسائل في الانتظار: "+count+"\nالتشغيل الدوري يتبع قيود البطارية في أندرويد وقد يتأخر عن الموعد.");}
 private void pair(){String base=url.getText().toString(),key=token.getText().toString().trim();int selectedMinutes=minutes[interval.getSelectedItemPosition()];status.setText("اختبار الاقتران…");new Thread(()->{try{String origin=SyncClient.origin(base);if(key.length()<32)throw new Exception("اضغط ربط هذا الهاتف تلقائيًا أولًا");JSONObject reply=SyncClient.request(origin,key,"/api/integrations/devices/health",null);if(!reply.optString("scope").equals("postal"))throw new Exception("الرمز ليس لأداة أندرويد");SyncClient.prefs(this).edit().putString("origin",origin).putString("token",key).putInt("minutes",selectedMinutes).putString("lastStatus","تم الاقتران. امنح إذن الإشعارات، ثم اختبر برسالة جديدة.").apply();JobScheduler scheduler=(JobScheduler)getSystemService(JOB_SCHEDULER_SERVICE);scheduler.cancel(5173);if(selectedMinutes>0)scheduler.schedule(new JobInfo.Builder(5173,new ComponentName(this,SyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(selectedMinutes*60000L).setPersisted(true).build());runOnUiThread(this::showStatus);}catch(Exception e){runOnUiThread(()->status.setText(e.getMessage()));}}).start();}
}

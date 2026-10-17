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
 private EditText url,token;private TextView status;private Spinner interval;private final int[] hours={0,1,3,6,12,24};
 @Override public void onCreate(Bundle saved){super.onCreate(saved);LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setPadding(32,48,32,32);body.setLayoutDirection(View.LAYOUT_DIRECTION_RTL);ScrollView scroll=new ScrollView(this);scroll.addView(body);setContentView(scroll);
  TextView title=new TextView(this);title.setText("وصل — ربط البريد المصري");title.setTextSize(24);body.addView(title);
  TextView info=new TextView(this);info.setText("الأداة تقرأ إشعارات EGYPT POST الجديدة من تطبيق الرسائل فقط بعد منح الإذن. لا تقرأ سجل الرسائل القديم. لو الإنترنت فصل، الرسائل تفضل في الانتظار. لازم تراجع الربط أول مرة من منصة وصل.");info.setPadding(0,20,0,20);body.addView(info);
  url=new EditText(this);url.setHint("بوابة الأجهزة: https://…convex.site");url.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_URI);url.setText(SyncClient.prefs(this).getString("origin",""));body.addView(url);
  token=new EditText(this);token.setHint("رمز اقتران أندرويد من وصل");token.setInputType(InputType.TYPE_CLASS_TEXT|InputType.TYPE_TEXT_VARIATION_PASSWORD);token.setText(SyncClient.prefs(this).getString("token",""));body.addView(token);
  interval=new Spinner(this);interval.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,new String[]{"لما أطلب فقط","كل ساعة","كل 3 ساعات","كل 6 ساعات","كل 12 ساعة","كل 24 ساعة"}));int current=SyncClient.prefs(this).getInt("hours",0);for(int i=0;i<hours.length;i++)if(current==hours[i])interval.setSelection(i);body.addView(interval);
  button(body,"حفظ واختبار الاقتران",()->pair());button(body,"منح إذن قراءة إشعارات البريد",()->startActivity(new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)));button(body,"السماح بتنبيهات متابعة الطلبات",()->{if(android.os.Build.VERSION.SDK_INT>=33)requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},1);});
  button(body,"مزامنة الآن",()->{status.setText("جاري المزامنة…");new Thread(()->{SyncClient.sync(this);runOnUiThread(this::showStatus);}).start();});status=new TextView(this);status.setPadding(0,24,0,0);body.addView(status);showStatus();
 }
 private void button(LinearLayout view,String text,Runnable action){Button b=new Button(this);b.setText(text);b.setOnClickListener(v->action.run());view.addView(b);}
 private void showStatus(){String pending=SyncClient.prefs(this).getString("queue","[]");int count=0;try{count=new org.json.JSONArray(pending).length();}catch(Exception ignored){}status.setText(SyncClient.prefs(this).getString("lastStatus","لم يتم الاقتران بعد")+"\nرسائل في الانتظار: "+count+"\nالتشغيل الدوري يتبع قيود البطارية في أندرويد وقد يتأخر عن الموعد.");}
 private void pair(){String base=url.getText().toString(),key=token.getText().toString().trim();int selectedHours=hours[interval.getSelectedItemPosition()];status.setText("اختبار الاقتران…");new Thread(()->{try{String origin=SyncClient.origin(base);if(key.length()<32)throw new Exception("انسخ رمز الاقتران كاملًا");JSONObject reply=SyncClient.request(origin,key,"/api/integrations/devices/health",null);if(!reply.optString("scope").equals("postal"))throw new Exception("الرمز ليس لأداة أندرويد");SyncClient.prefs(this).edit().putString("origin",origin).putString("token",key).putInt("hours",selectedHours).putString("lastStatus","تم الاقتران. امنح إذن الإشعارات، ثم اختبر برسالة جديدة.").apply();JobScheduler scheduler=(JobScheduler)getSystemService(JOB_SCHEDULER_SERVICE);scheduler.cancel(5173);if(selectedHours>0)scheduler.schedule(new JobInfo.Builder(5173,new ComponentName(this,SyncJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPeriodic(selectedHours*3600000L).setPersisted(true).build());runOnUiThread(this::showStatus);}catch(Exception e){runOnUiThread(()->status.setText(e.getMessage()));}}).start();}
}

package app.wasl.companion;
import android.accessibilityservice.AccessibilityService;
import android.content.SharedPreferences;
import android.graphics.Rect;
import android.os.Handler;
import android.view.accessibility.*;
import java.util.*;
import org.json.JSONArray;

/** Explicit, time-limited reading of visible PAID-labelled chat rows. No gestures or messages. */
public class PaidReader extends AccessibilityService {
 private final Handler handler=new Handler(android.os.Looper.getMainLooper());private boolean scheduled;
 @Override public void onAccessibilityEvent(AccessibilityEvent event){if(!"com.whatsapp.w4b".contentEquals(event.getPackageName()==null?"":event.getPackageName()))return;if(scheduled)return;scheduled=true;handler.postDelayed(()->{scheduled=false;scan();},500);}
 @Override public void onInterrupt(){stop();}
 @Override public void onDestroy(){handler.removeCallbacksAndMessages(null);stop();super.onDestroy();}
 private void stop(){SyncClient.prefs(this).edit().putLong("paidUntil",0).apply();}
 private void scan(){SharedPreferences p=SyncClient.prefs(this);if(p.getLong("paidUntil",0)<System.currentTimeMillis())return;AccessibilityNodeInfo root=getRootInActiveWindow();if(root==null||!"com.whatsapp.w4b".contentEquals(root.getPackageName()==null?"":root.getPackageName()))return;
  try{Rect screen=new Rect();root.getBoundsInScreen(screen);ArrayList<AccessibilityNodeInfo> nodes=new ArrayList<>();walk(root,nodes,0);Set<String> accepted=new TreeSet<>(p.getStringSet("paidPhones",Collections.emptySet()));int before=accepted.size();
   for(AccessibilityNodeInfo node:nodes){String phone=PaidNumbers.normalize(node.getText()==null?null:node.getText().toString());if(phone==null||!node.isVisibleToUser())continue;AccessibilityNodeInfo row=node;
    for(int up=0;up<7&&row!=null;up++,row=row.getParent()){Rect bounds=new Rect();row.getBoundsInScreen(bounds);if(bounds.height()>screen.height()/3)break;if(bounds.width()<screen.width()/2)continue;ArrayList<AccessibilityNodeInfo> values=new ArrayList<>();walk(row,values,0);boolean badge=false;Set<String> rowPhones=new HashSet<>();for(AccessibilityNodeInfo v:values){if(!v.isVisibleToUser())continue;String t=v.getText()==null?"":v.getText().toString().trim();if(t.equalsIgnoreCase("paid"))badge=true;String number=PaidNumbers.normalize(t);if(number!=null)rowPhones.add(number);}if(badge&&rowPhones.size()==1&&rowPhones.contains(phone)){if(accepted.size()<500)accepted.add(phone);break;}}
   }
   if(accepted.size()!=before)p.edit().putStringSet("paidPhones",accepted).putString("paidStatus","تمت قراءة "+accepted.size()+" رقم ظاهر بجواره PAID. رجّع لوصل لمراجعة الأرقام وإرسالها.").apply();
  }catch(Exception ignored){p.edit().putString("paidStatus","تعذرت قراءة هذه الشاشة. لن يتم إرسال أو تأكيد أي رقم تلقائيًا.").apply();}
 }
 private void walk(AccessibilityNodeInfo n,List<AccessibilityNodeInfo> out,int depth){if(n==null||depth>35||out.size()>=1500)return;out.add(n);for(int i=0;i<n.getChildCount()&&out.size()<1500;i++)walk(n.getChild(i),out,depth+1);}
}

package app.wasl.companion;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.app.Notification;
import android.os.Bundle;
import android.os.Parcelable;
import java.util.Set;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import java.util.Locale;
import org.json.JSONObject;
/** Reads Samsung and Google message bundles; never reads unrelated notification senders. */
public class PostalListener extends NotificationListenerService {
 private static final Set<String> SMS_APPS=new java.util.HashSet<>(java.util.Arrays.asList("com.google.android.apps.messaging","com.samsung.android.messaging","com.android.mms"));
 @Override public void onListenerConnected(){SyncClient.prefs(this).edit().putLong("postalListenerConnected",System.currentTimeMillis()).apply();try{for(StatusBarNotification n:getActiveNotifications())capture(n);}catch(Exception ignored){} }
 @Override public void onNotificationPosted(StatusBarNotification n){capture(n);}
 private void capture(StatusBarNotification n){
  if(!SMS_APPS.contains(n.getPackageName()))return;
  Bundle extras=n.getNotification().extras;
  String sender=String.valueOf(extras.getCharSequence(Notification.EXTRA_TITLE,""));
  Parcelable[] messages=extras.getParcelableArray(Notification.EXTRA_MESSAGES);
  if(messages!=null)for(Parcelable item:messages)if(item instanceof Bundle){Bundle b=(Bundle)item;CharSequence fromValue=b.getCharSequence("sender");String from=fromValue==null?sender:fromValue.toString();accept(from,String.valueOf(b.getCharSequence("text","")),b.getLong("time",n.getPostTime()));}
  if((n.getNotification().flags&Notification.FLAG_GROUP_SUMMARY)!=0)return;
  CharSequence[] lines=extras.getCharSequenceArray(Notification.EXTRA_TEXT_LINES);
  long at=n.getNotification().when>0?n.getNotification().when:n.getPostTime();
  if(lines!=null)for(CharSequence line:lines)accept(sender,String.valueOf(line),at);
  accept(sender,String.valueOf(extras.getCharSequence(Notification.EXTRA_BIG_TEXT,extras.getCharSequence(Notification.EXTRA_TEXT,""))),at);
 }
 private void accept(String sender,String body,long at){
  String text=PostalHistoryActivity.digits(body);if(!PostalHistoryActivity.postal(sender,text))return;
  try{if(at<=0||at>System.currentTimeMillis())at=System.currentTimeMillis();String raw=sender.replaceAll("[\\s_-]","").toUpperCase(Locale.ROOT)+"\n"+text+"\n"+at;
   byte[] hash=MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));StringBuilder id=new StringBuilder();for(byte b:hash)id.append(String.format(Locale.ROOT,"%02x",b&255));
   JSONObject event=new JSONObject().put("eventId",id.toString()).put("sender",sender).put("text",text).put("receivedAt",java.time.Instant.ofEpochMilli(at).toString());
   SyncClient.enqueue(getApplicationContext(),event);SyncClient.prefs(this).edit().putLong("lastPostalCaptured",System.currentTimeMillis()).apply();
   if(SyncClient.prefs(this).getBoolean("livePostal",true))new Thread(()->SyncClient.sync(getApplicationContext()),"wasl-live-postal").start();
  }catch(Exception ignored){}
 }
}

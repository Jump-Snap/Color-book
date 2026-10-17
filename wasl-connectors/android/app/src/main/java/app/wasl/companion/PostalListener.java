package app.wasl.companion;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import android.app.Notification;
import android.os.Bundle;
import java.util.Set;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

public class PostalListener extends NotificationListenerService {
 private static final Set<String> SMS_APPS=new java.util.HashSet<>(java.util.Arrays.asList("com.google.android.apps.messaging","com.samsung.android.messaging","com.android.mms"));
 @Override public void onNotificationPosted(StatusBarNotification sbn){
  if(!SMS_APPS.contains(sbn.getPackageName()))return;
  Bundle extras=sbn.getNotification().extras;
  String sender=String.valueOf(extras.getCharSequence(Notification.EXTRA_TITLE,""));
  if(!sender.toUpperCase(java.util.Locale.ROOT).matches(".*EGYPT[ -]?POST.*")&&!sender.contains("البريد المصري"))return;
  String text=String.valueOf(extras.getCharSequence(Notification.EXTRA_BIG_TEXT,extras.getCharSequence(Notification.EXTRA_TEXT,"")));
  if(!text.toUpperCase(java.util.Locale.ROOT).matches("(?s).*[A-Z]{2}\\s?\\d{9}\\s?EG.*"))return;
  try{
   String raw=sender+"\n"+text+"\n"+sbn.getNotification().when;
   byte[] hash=MessageDigest.getInstance("SHA-256").digest(raw.getBytes(StandardCharsets.UTF_8));StringBuilder id=new StringBuilder();for(byte b:hash)id.append(String.format("%02x",b&255));
   JSONObject event=new JSONObject().put("eventId",id.toString()).put("sender",sender).put("text",text).put("receivedAt",java.time.Instant.ofEpochMilli(sbn.getPostTime()).toString());
   SyncClient.enqueue(getApplicationContext(),event);
  }catch(Exception ignored){/* Never log private SMS content or authentication data. */}
 }
}

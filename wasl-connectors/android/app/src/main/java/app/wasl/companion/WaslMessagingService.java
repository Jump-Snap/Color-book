package app.wasl.companion;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;
public class WaslMessagingService extends FirebaseMessagingService {
 @Override public void onNewToken(String token){PushClient.register(getApplicationContext(),token);}
 @Override public void onMessageReceived(RemoteMessage message){if(!SyncClient.prefs(this).getBoolean("pushOptIn",false)||SyncClient.prefs(this).getString("token","").isEmpty())return;Map<String,String> d=message.getData();String id=d.get("id"),title=d.get("title"),body=d.get("body");if(id!=null&&title!=null&&body!=null)PushClient.display(this,id,title,body);}
}

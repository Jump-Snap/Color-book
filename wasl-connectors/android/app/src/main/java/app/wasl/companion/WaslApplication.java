package app.wasl.companion;
import android.app.Application;
public class WaslApplication extends Application {
 @Override public void onCreate(){super.onCreate();if(SyncClient.prefs(this).getBoolean("pushOptIn",false))PushClient.initialize(this);if(!SyncClient.prefs(this).getString("token","").isEmpty()){SyncClient.schedule(this);if(PermissionsActivity.postalEnabled(this))android.service.notification.NotificationListenerService.requestRebind(new android.content.ComponentName(this,PostalListener.class));}}
}

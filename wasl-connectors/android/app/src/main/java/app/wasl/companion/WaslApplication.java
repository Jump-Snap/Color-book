package app.wasl.companion;
import android.app.Application;
public class WaslApplication extends Application {
 @Override public void onCreate(){super.onCreate();if(SyncClient.prefs(this).getBoolean("pushOptIn",false))PushClient.initialize(this);}
}

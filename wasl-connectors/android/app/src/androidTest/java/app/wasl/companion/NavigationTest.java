package app.wasl.companion;

import android.content.Context;
import android.content.Intent;
import android.graphics.Rect;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import androidx.test.uiautomator.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import static org.junit.Assert.*;

/** Verifies the user's reported tap targets and actual Android permission handoff. */
@RunWith(AndroidJUnit4.class)
public class NavigationTest {
 private final Context app=InstrumentationRegistry.getInstrumentation().getTargetContext();
 private final UiDevice device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation());
 private UiObject2 visible(String text){UiObject2 v=device.wait(Until.findObject(By.text(text)),15000);assertNotNull("Missing: "+text,v);return v;}
 private void screenshot(String name) throws Exception {device.executeShellCommand("mkdir -p /sdcard/Download/wasl-ui-proof");device.executeShellCommand("screencap -p /sdcard/Download/wasl-ui-proof/"+name+".png");}
 @Test public void menuAndPermissionHandoff() throws Exception {
  SyncClient.prefs(app).edit().putBoolean("permissionIntro4",true).commit();
  device.setOrientationNatural();
  app.startActivity(new Intent(app,OrdersActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TASK));
  UiObject2 menu=visible("القائمة — الربط والأذونات");Rect r=menu.getVisibleBounds();float density=app.getResources().getDisplayMetrics().density;
  assertTrue("Left edge clearance",r.left>=19*density);assertTrue("Right edge clearance",device.getDisplayWidth()-r.right>=19*density);
  assertTrue("Large tap height",r.height()>=59*density);assertTrue("Above gesture area",device.getDisplayHeight()-r.bottom>=8*density);screenshot("orders-menu");
  menu.click();visible("الأذونات وحل مشاكل الوصول");screenshot("centered-navigation");
  visible("الأذونات وحل مشاكل الوصول").click();visible("تشغيل وصل على الموبايل");visible("تفعيل الأذونات المطلوبة بالترتيب");screenshot("permissions");
  visible("تفعيل الأذونات المطلوبة بالترتيب").click();
  assertTrue("Android permission prompt or system settings",device.wait(Until.hasObject(By.pkg(java.util.regex.Pattern.compile("(com.android|com.google.android).permissioncontroller"))),15000)||device.hasObject(By.pkg("com.android.settings")));
  device.pressBack();
 }
 @Test public void postalFiltersAndPairingOrigins(){
  assertTrue(PostalHistoryActivity.postal("EGYPT POST","تم تسليم الشحنة EN١٢٣٤٥٦٧٨٩EG"));
  assertTrue(PostalHistoryActivity.postal("Egypt-Post","EN123456789EG تم إنشاء الشحنة"));
  assertFalse(PostalHistoryActivity.postal("Bank","EN123456789EG"));
  assertFalse(PostalHistoryActivity.postal("EGYPTPOST","رصيد أو رقم غير متعلق بالشحن 123456"));
  assertTrue(NativePairing.trusted("https://laqexg5wjrd9szk3v5b4xglm.macaly.app/"));
  for(String url:new String[]{"http://laqexg5wjrd9szk3v5b4xglm.macaly.app/","https://laqexg5wjrd9szk3v5b4xglm.macaly.app.evil.example/","https://evil@laqexg5wjrd9szk3v5b4xglm.macaly.app/","https://laqexg5wjrd9szk3v5b4xglm.macaly.app:444/","file:///tmp/app","about:blank"})assertFalse(url,NativePairing.trusted(url));
 }
 @Test public void historicalMessagesHaveNoCodeEntry() throws Exception {
  app.startActivity(new Intent(app,PostalHistoryActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
  visible("رسائل البريد القديمة");visible("اقرأ رسائل البريد القديمة من الموبايل");
  assertFalse("No pasted pairing tokens",device.hasObject(By.clazz("android.widget.EditText")));screenshot("old-postal-messages");
 }
}

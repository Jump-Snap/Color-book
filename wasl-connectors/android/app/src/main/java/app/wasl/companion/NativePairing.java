package app.wasl.companion;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.webkit.WebView;
import android.widget.Toast;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import org.json.JSONObject;
import java.util.Collections;
import java.util.UUID;

/** Origin-bound pairing. No account JWT or password crosses the bridge. */
final class NativePairing {
 static final String ORIGIN=BuildConfig.WASL_WEB_ORIGIN;
 static final String GATEWAY="https://suokxziofqqsqcnncepc.supabase.co";
 private final Activity activity;private final WebView web;private final Handler handler=new Handler(Looper.getMainLooper());
 private String requestId;private long deadline;private boolean verifying;private final boolean supported;
 NativePairing(Activity a,WebView w){activity=a;web=w;supported=WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER);
  if(supported)WebViewCompat.addWebMessageListener(w,"WaslDevice",Collections.singleton(ORIGIN),(view,message,origin,main,reply)->{
   if(!main||!ORIGIN.equals(origin.toString())||!trusted(web.getUrl())||verifying)return;
   try{String raw=message.getData();if(raw==null||raw.length()>1500)return;JSONObject data=new JSONObject(raw);if("requestPair".equals(data.optString("type"))){handler.post(this::start);return;}if(requestId==null||System.currentTimeMillis()>deadline||!requestId.equals(data.optString("requestId")))return;
    if("pairError".equals(data.optString("type"))){Toast.makeText(a,"سجّل الدخول في وصل، ثم اضغط «ربط هذا الهاتف»",Toast.LENGTH_LONG).show();return;}
    if(!"paired".equals(data.optString("type")))return;String postal=data.optString("postalToken");if(!postal.matches("[a-f0-9]{64}"))return;
    verifying=true;String nonce=requestId;
    new Thread(()->{try{
     JSONObject s=SyncClient.request(GATEWAY,postal,"/api/integrations/devices/health",null);
     if(!"postal".equals(s.optString("scope")))throw new Exception();
     handler.post(()->{if(!nonce.equals(requestId)||System.currentTimeMillis()>deadline||!trusted(web.getUrl())){verifying=false;return;}
      SyncClient.prefs(a).edit().putString("token",postal).putString("origin",GATEWAY).putString("lastStatus","تم الربط التلقائي. فعّل أذونات الهاتف المطلوبة.").apply();requestId=null;verifying=false;
      Toast.makeText(a,"تم ربط البريد والإشعارات بدون نسخ أكواد",Toast.LENGTH_LONG).show();SyncClient.schedule(a);PushClient.enable(a);a.startActivity(new Intent(a,PermissionsActivity.class));
     });
    }catch(Exception e){handler.post(()->{verifying=false;Toast.makeText(a,"تعذر التحقق من الربط. أعد المحاولة مع اتصال الإنترنت",Toast.LENGTH_LONG).show();});}}).start();
   }catch(Exception ignored){/* Never log device credentials. */}
  });
 }
 static boolean trusted(String url){if(url==null)return false;Uri u=Uri.parse(url);return "https".equals(u.getScheme())&&Uri.parse(ORIGIN).getHost().equals(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&u.getUserInfo()==null;}
 void start(){
  if(!supported){Toast.makeText(activity,"حدّث Android System WebView لتفعيل الربط المباشر",Toast.LENGTH_LONG).show();return;}
  if(!trusted(web.getUrl())){Toast.makeText(activity,"افتح وصل وسجّل الدخول أولًا",Toast.LENGTH_LONG).show();return;}
  if(verifying)return;requestId=UUID.randomUUID().toString();deadline=System.currentTimeMillis()+300000;
  String id=JSONObject.quote(requestId);
  web.evaluateJavascript("(()=>{window.__waslPairRequestId="+id+";const b=document.querySelector('[data-wasl-page=\"settings\"]');if(!b){window.WaslDevice.postMessage(JSON.stringify({type:'pairError',requestId:"+id+"}));return;}b.click();setTimeout(()=>window.dispatchEvent(new CustomEvent('wasl-pair-request',{detail:{requestId:"+id+"}})),700);})()",null);
  Toast.makeText(activity,"اضغط «ربط هذا الهاتف» في صفحة وصل للموافقة",Toast.LENGTH_LONG).show();
 }
 void clear(){requestId=null;handler.removeCallbacksAndMessages(null);}
}

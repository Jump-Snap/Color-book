package app.wasl.companion;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.webkit.*;
import android.widget.*;
import java.io.File;
import java.util.UUID;

/** Private web workspace; camera/file permissions stay with Android's system picker. */
public class OrdersActivity extends Activity {
 private static final String HOME="https://laqexg5wjrd9szk3v5b4xglm.macaly.app/";
 private WebView web; private ValueCallback<Uri[]> upload; private Uri camera;
 @Override public void onCreate(Bundle state){super.onCreate(state);
  LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setLayoutDirection(android.view.View.LAYOUT_DIRECTION_RTL);
  LinearLayout toolbar=new LinearLayout(this);add(toolbar,"الطلبات",()->web.loadUrl(HOME));add(toolbar,"ربط واتساب",()->startActivity(new Intent(this,PaidActivity.class)));add(toolbar,"ربط رسائل الشحن",()->startActivity(new Intent(this,MainActivity.class)));body.addView(toolbar);
  web=new WebView(this);body.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(body);
  web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(true);web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){Uri u=r.getUrl();if("https".equals(u.getScheme())&&"laqexg5wjrd9szk3v5b4xglm.macaly.app".equals(u.getHost()))return false;if("https".equals(u.getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception ignored){}return true;}});
  web.setWebChromeClient(new WebChromeClient(){
   @Override public void onPermissionRequest(PermissionRequest request){request.deny();}
   @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> callback,FileChooserParams params){
    if(upload!=null)upload.onReceiveValue(null);upload=callback;camera=null;
    Intent files=new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");files.putExtra(Intent.EXTRA_MIME_TYPES,new String[]{"image/*","application/pdf","text/*","application/xml"});files.putExtra(Intent.EXTRA_ALLOW_MULTIPLE,params.getMode()==FileChooserParams.MODE_OPEN_MULTIPLE);
    Intent chooser=Intent.createChooser(files,"صوّر بوليصة أو اختار ملف");
    boolean images=params.getAcceptTypes().length==0;for(String t:params.getAcceptTypes())if(t.isEmpty()||t.contains("image")||t.equals("*/*"))images=true;
    if(images){camera=Uri.parse("content://"+getPackageName()+".camera/capture/"+UUID.randomUUID()+".jpg");Intent capture=new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT,camera).addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_READ_URI_PERMISSION);capture.setClipData(android.content.ClipData.newRawUri("بوليصة",camera));chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS,new Intent[]{capture});}
    try{startActivityForResult(chooser,830);}catch(Exception e){upload.onReceiveValue(null);upload=null;Toast.makeText(OrdersActivity.this,"تعذر فتح اختيار الملفات",Toast.LENGTH_LONG).show();}return true;
   }
  });
  if(state==null)web.loadUrl(HOME);else{camera=state.getParcelable("camera");web.restoreState(state);}
 }
 private void add(LinearLayout row,String text,Runnable action){Button b=new Button(this);b.setText(text);b.setTextSize(12);b.setOnClickListener(v->action.run());row.addView(b,new LinearLayout.LayoutParams(0,-2,1));}
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=830||upload==null)return;Uri[] values=null;if(result==RESULT_OK){if(data!=null&&data.getClipData()!=null){int count=Math.min(30,data.getClipData().getItemCount());values=new Uri[count];for(int i=0;i<count;i++)values[i]=data.getClipData().getItemAt(i).getUri();}else if(data!=null&&data.getData()!=null)values=new Uri[]{data.getData()};else if(camera!=null){try{File f=CameraProvider.file(this,camera);if(f.length()>0)values=new Uri[]{camera};}catch(Exception ignored){}}}upload.onReceiveValue(values);upload=null;camera=null;}
 @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);web.saveState(state);state.putParcelable("camera",camera);}
 @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else super.onBackPressed();}
 @Override protected void onDestroy(){if(upload!=null)upload.onReceiveValue(null);web.destroy();super.onDestroy();}
}

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
 private static final String HOME=NativePairing.ORIGIN+"/";
 private boolean pendingPair; private NativePairing pairing; private WebView web; private ValueCallback<Uri[]> upload; private Uri camera;
 @Override public void onCreate(Bundle state){super.onCreate(state);pendingPair=getIntent().getBooleanExtra("pair",false);
  LinearLayout body=new LinearLayout(this);body.setOrientation(LinearLayout.VERTICAL);body.setLayoutDirection(android.view.View.LAYOUT_DIRECTION_RTL);
  web=new WebView(this);body.addView(web,new LinearLayout.LayoutParams(-1,0,1));
  LinearLayout menuArea=new LinearLayout(this);menuArea.setOrientation(LinearLayout.VERTICAL);int gap=AppUi.dp(this,20);menuArea.setPadding(gap,AppUi.dp(this,8),gap,AppUi.dp(this,8));AppUi.button(this,menuArea,"القائمة — الربط والأذونات",this::openMenu);body.addView(menuArea);AppUi.install(this,body);
  pairing=new NativePairing(this,web);
  web.getSettings().setJavaScriptEnabled(true);web.getSettings().setDomStorageEnabled(true);web.getSettings().setAllowFileAccess(false);web.getSettings().setAllowContentAccess(true);web.getSettings().setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  web.setWebViewClient(new WebViewClient(){@Override public void onPageFinished(WebView v,String url){if(pendingPair&&NativePairing.trusted(url)){pendingPair=false;v.post(()->pairing.start());}}@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest r){Uri u=r.getUrl();if(NativePairing.trusted(u.toString()))return false;if("https".equals(u.getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(Exception ignored){}return true;}});
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
  if(android.os.Build.VERSION.SDK_INT>=33)getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT,this::navigateBack);
  if(state==null)web.loadUrl(HOME);else{camera=state.getParcelable("camera");web.restoreState(state);}

 }
 private void openMenu(){
  LinearLayout list=new LinearLayout(this);list.setOrientation(LinearLayout.VERTICAL);list.setLayoutDirection(android.view.View.LAYOUT_DIRECTION_RTL);int p=AppUi.dp(this,20);list.setPadding(p,p,p,p);
  ScrollView menuScroll=new ScrollView(this);menuScroll.addView(list);
  android.app.AlertDialog dialog=new android.app.AlertDialog.Builder(this).setTitle("قائمة وصل").setView(menuScroll).setNegativeButton("إغلاق",null).create();
  AppUi.button(this,list,"ربط هذا الهاتف تلقائيًا",()->{dialog.dismiss();pairing.start();});
  AppUi.button(this,list,"رسائل البريد القديمة",()->{dialog.dismiss();startActivity(new Intent(this,PostalHistoryActivity.class));});
  AppUi.button(this,list,"الطلبات",()->{dialog.dismiss();web.loadUrl(HOME);});
  AppUi.button(this,list,"الأذونات وحل مشاكل الوصول",()->{dialog.dismiss();startActivity(new Intent(this,PermissionsActivity.class));});
  AppUi.button(this,list,"ربط إشعارات الشحن",()->{dialog.dismiss();startActivity(new Intent(this,MainActivity.class));});
  dialog.show();
 }
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=830||upload==null)return;Uri[] values=null;if(result==RESULT_OK){if(data!=null&&data.getClipData()!=null){int count=Math.min(30,data.getClipData().getItemCount());values=new Uri[count];for(int i=0;i<count;i++)values[i]=data.getClipData().getItemAt(i).getUri();}else if(data!=null&&data.getData()!=null)values=new Uri[]{data.getData()};else if(camera!=null){try{File f=CameraProvider.file(this,camera);if(f.length()>0)values=new Uri[]{camera};}catch(Exception ignored){}}}upload.onReceiveValue(values);upload=null;camera=null;}
 @Override protected void onSaveInstanceState(Bundle state){super.onSaveInstanceState(state);web.saveState(state);state.putParcelable("camera",camera);}
 // Android 33+ uses OnBackInvokedDispatcher above; this override serves API 26–32 only.
 @android.annotation.SuppressLint("GestureBackNavigation")
 @Override public void onBackPressed(){navigateBack();}
 private void navigateBack(){if(web.canGoBack())web.goBack();else finish();}
 @Override protected void onNewIntent(Intent intent){super.onNewIntent(intent);setIntent(intent);if(intent.getBooleanExtra("pair",false))web.post(()->pairing.start());}
 @Override protected void onDestroy(){pairing.clear();if(upload!=null)upload.onReceiveValue(null);web.destroy();super.onDestroy();}
}
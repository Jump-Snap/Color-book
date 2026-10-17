package app.wasl.companion;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Build;
import android.view.View;
import android.view.WindowInsets;
import android.widget.Button;
import android.widget.LinearLayout;

/** Keeps every native screen away from system bars, cutouts and the keyboard. */
final class AppUi {
 static final int INK=Color.rgb(21,71,66), BACK=Color.rgb(246,249,248);
 static int dp(Activity a,int value){return Math.round(value*a.getResources().getDisplayMetrics().density);}
 static void install(Activity a,View content){
  content.setBackgroundColor(BACK);
  if(Build.VERSION.SDK_INT>=30){
   a.getWindow().setDecorFitsSystemWindows(false);
   a.getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR|View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
  }
  final int l=content.getPaddingLeft(),t=content.getPaddingTop(),r=content.getPaddingRight(),b=content.getPaddingBottom();
  content.setOnApplyWindowInsetsListener((v,w)->{
   if(Build.VERSION.SDK_INT>=30){Insets i=w.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());v.setPadding(l+i.left,t+i.top,r+i.right,b+i.bottom);return WindowInsets.CONSUMED;}
   v.setPadding(l+w.getSystemWindowInsetLeft(),t+w.getSystemWindowInsetTop(),r+w.getSystemWindowInsetRight(),b+w.getSystemWindowInsetBottom());return w.consumeSystemWindowInsets();
  });
  a.setContentView(content);content.requestApplyInsets();
 }
 static Button button(Activity a,LinearLayout parent,String text,Runnable action){
  Button v=new Button(a);v.setText(text);v.setTextSize(17);v.setAllCaps(false);v.setTypeface(null,Typeface.BOLD);v.setTextColor(Color.WHITE);v.setMinHeight(dp(a,60));v.setPadding(dp(a,16),dp(a,12),dp(a,16),dp(a,12));
  GradientDrawable bg=new GradientDrawable();bg.setColor(INK);bg.setCornerRadius(dp(a,14));v.setBackground(bg);
  LinearLayout.LayoutParams p=new LinearLayout.LayoutParams(-1,-2);p.setMargins(0,dp(a,6),0,dp(a,6));parent.addView(v,p);v.setOnClickListener(x->action.run());return v;
 }
}

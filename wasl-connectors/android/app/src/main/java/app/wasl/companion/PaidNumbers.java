package app.wasl.companion;
public final class PaidNumbers {
 private PaidNumbers(){}
 public static String normalize(String text){if(text==null)return null;StringBuilder ascii=new StringBuilder();for(char c:text.toCharArray()){if(c>='٠'&&c<='٩')ascii.append((char)('0'+c-'٠'));else if(c>='۰'&&c<='۹')ascii.append((char)('0'+c-'۰'));else ascii.append(c);}String s=ascii.toString().trim();if(!s.matches("\\+?[0-9\\s().-]+"))return null;s=s.replaceAll("[\\s().+-]","");if(s.startsWith("00"))s=s.substring(2);if(s.matches("01[0125][0-9]{8}"))s="20"+s.substring(1);if(s.matches("1[0125][0-9]{8}"))s="20"+s;return s.matches("201[0125][0-9]{8}")?"+"+s:null;}
}

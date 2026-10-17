import app.wasl.companion.PaidNumbers;
public class PaidNumbersTest {
 public static void main(String[] args){
  for(String s:new String[]{"+20 10 00000000","01000000000","00201000000000","١٠٠٠٠٠٠٠٠٠","+٢٠ ١٠ ٠٠٠٠٠٠٠٠","۰۱۰۰۰۰۰۰۰۰۰"})if(!"+201000000000".equals(PaidNumbers.normalize(s)))throw new AssertionError("Egyptian phone normalization failed");
  for(String s:new String[]{"رسالة +20 10 00000000","+201000000000 hello","123456","+201300000000","20 10 00000000 / 01000000001","٠٦٤١٢٣","14:30","12.75",null})if(PaidNumbers.normalize(s)!=null)throw new AssertionError("A snippet, invalid prefix or unrelated number was accepted");
  System.out.println("Paid number format checks passed");
 }
}

package app.wasl.companion;
import android.content.*;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import java.io.*;

/** Only grants access to one random capture URI, never arbitrary filesystem paths. */
public class CameraProvider extends ContentProvider {
 static File file(Context c,Uri u)throws FileNotFoundException{if(!u.getPath().matches("/capture/[a-f0-9-]{36}\\.jpg"))throw new FileNotFoundException();File dir=new File(c.getCacheDir(),"captures");if(!dir.exists()&&!dir.mkdirs())throw new FileNotFoundException();return new File(dir,u.getLastPathSegment());}
 @Override public boolean onCreate(){File dir=new File(getContext().getCacheDir(),"captures");File[] files=dir.listFiles();if(files!=null)for(File f:files)if(f.lastModified()<System.currentTimeMillis()-86400000L)f.delete();return true;}
 @Override public String getType(Uri uri){return "image/jpeg";}
 @Override public ParcelFileDescriptor openFile(Uri uri,String mode)throws FileNotFoundException{return ParcelFileDescriptor.open(file(getContext(),uri),ParcelFileDescriptor.parseMode(mode));}
 @Override public Cursor query(Uri uri,String[] projection,String selection,String[] args,String sort){String[] cols=projection==null?new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE}:projection;MatrixCursor cursor=new MatrixCursor(cols);try{File f=file(getContext(),uri);Object[] row=new Object[cols.length];for(int i=0;i<cols.length;i++)row[i]=OpenableColumns.DISPLAY_NAME.equals(cols[i])?f.getName():OpenableColumns.SIZE.equals(cols[i])?f.length():null;cursor.addRow(row);}catch(Exception ignored){}return cursor;}
 @Override public Uri insert(Uri uri,ContentValues values){throw new UnsupportedOperationException();}
 @Override public int update(Uri uri,ContentValues values,String selection,String[] args){return 0;}
 @Override public int delete(Uri uri,String selection,String[] args){return 0;}
}

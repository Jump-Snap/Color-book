package app.wasl.companion;
import android.app.job.JobService;
import android.app.job.JobParameters;
public class SyncJob extends JobService {
 private volatile boolean cancelled;
 @Override public boolean onStartJob(JobParameters params){cancelled=false;new Thread(()->{boolean ok=SyncClient.sync(getApplicationContext());if(!cancelled)jobFinished(params,!ok);},"wasl-postal-sync").start();return true;}
 @Override public boolean onStopJob(JobParameters params){cancelled=true;return true;}
}

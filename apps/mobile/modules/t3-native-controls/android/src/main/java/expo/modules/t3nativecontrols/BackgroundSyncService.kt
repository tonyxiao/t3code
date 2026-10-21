package expo.modules.t3nativecontrols

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.Looper
import com.facebook.react.HeadlessJsTaskService
import com.facebook.react.bridge.Arguments
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import expo.modules.kotlin.Promise

/** A bounded sync window; never restarts the app or extends itself in the background. */
class BackgroundSyncService : HeadlessJsTaskService() {
  private val handler = Handler(Looper.getMainLooper())
  private val expire = Runnable { stopSelf() }
  private var started = false

  private fun promoteToForeground() {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= 26) {
      manager.createNotificationChannel(
        NotificationChannel(CHANNEL, "Background sync", NotificationManager.IMPORTANCE_LOW)
      )
    }
    val builder = if (Build.VERSION.SDK_INT >= 26) {
      Notification.Builder(this, CHANNEL)
    } else {
      Notification.Builder(this)
    }
    val icon = resources.getIdentifier("notification_icon", "drawable", packageName)
    builder.setSmallIcon(if (icon != 0) icon else android.R.drawable.ic_dialog_info)
      .setContentTitle("Syncing open threads")
      .setContentText("Keeping recent chat history up to date")
      .setOngoing(true)
      .setShowWhen(false)
    packageManager.getLaunchIntentForPackage(packageName)?.let { intent ->
      builder.setContentIntent(
        PendingIntent.getActivity(
          this,
          0,
          intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      )
    }
    if (Build.VERSION.SDK_INT >= 29) {
      startForeground(
        NOTIFICATION_ID,
        builder.build(),
        ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
      )
    } else {
      startForeground(NOTIFICATION_ID, builder.build())
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    // A start cancelled before creation still needs foreground acknowledgement.
    promoteToForeground()
    if (pendingStarts > 0) pendingStarts -= 1
    running = true
    if (!requested) {
      stopSelf()
      return START_NOT_STICKY
    }
    if (!started) {
      started = true
      handler.postDelayed(expire, WINDOW_MS)
      // Headless JS keeps React Native timers running after the Activity pauses.
      super.onStartCommand(intent, flags, startId)
    }
    return START_NOT_STICKY
  }

  override fun getTaskConfig(intent: Intent?) = HeadlessJsTaskConfig(
    "T3BackgroundSync",
    Arguments.createMap(),
    WINDOW_MS + 5_000L,
    true
  )
  override fun onTimeout(startId: Int) {
    stopSelf()
  }
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }
  override fun onTaskRemoved(rootIntent: Intent?) {
    stopSelf()
  }

  override fun onDestroy() {
    handler.removeCallbacks(expire)
    running = false
    val promises = completionPromises.toList()
    completionPromises.clear()
    promises.forEach { it.resolve(null) }
    stopForeground(STOP_FOREGROUND_REMOVE)
    super.onDestroy()
  }

  companion object {
    private var running = false
    private var requested = false
    private var pendingStarts = 0
    private val mainHandler = Handler(Looper.getMainLooper())
    private val completionPromises = mutableListOf<Promise>()

    fun start(context: Context) = onMain {
      val wasRequested = requested
      requested = true
      pendingStarts += 1
      val intent = Intent(context, BackgroundSyncService::class.java)
      try {
        if (Build.VERSION.SDK_INT >= 26) {
          context.startForegroundService(intent)
        } else {
          context.startService(intent)
        }
      } catch (_: IllegalStateException) {
        requested = wasRequested
        pendingStarts -= 1
      } catch (_: SecurityException) {
        requested = wasRequested
        pendingStarts -= 1
      }
    }

    fun stop(context: Context) = onMain {
      requested = false
      // Let onStartCommand acknowledge a foreground start that Android has not delivered yet.
      if (running && pendingStarts == 0) {
        context.stopService(Intent(context, BackgroundSyncService::class.java))
      }
    }

    private fun onMain(action: () -> Unit) {
      if (Looper.myLooper() == Looper.getMainLooper()) {
        action()
      } else {
        mainHandler.post { action() }
      }
    }

    fun waitUntilStopped(promise: Promise) {
      if (running || pendingStarts > 0) completionPromises.add(promise) else promise.resolve(null)
    }

    private const val CHANNEL = "t3-background-sync"
    private const val NOTIFICATION_ID = 73631

    // Stop after ten minutes even when the OS would permit a longer session.
    // Android can invoke onTimeout earlier if its shared data-sync quota is spent.
    private const val WINDOW_MS = 10 * 60 * 1_000L
  }
}

package expo.modules.t3nativecontrols

import android.content.Intent
import android.os.Build
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class T3BackgroundSyncModule : Module() {
  @Volatile private var enabled = false

  override fun definition() = ModuleDefinition {
    Name("T3BackgroundSync")

    Function("setEnabled") { value: Boolean ->
      enabled = value
      if (!value) stopSync()
    }

    AsyncFunction("waitUntilStopped") { promise: Promise ->
      BackgroundSyncService.waitUntilStopped(promise)
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      if (enabled) {
        appContext.reactContext?.let { context ->
          try {
            val intent = Intent(context, BackgroundSyncService::class.java)
            if (Build.VERSION.SDK_INT >= 26) {
              context.startForegroundService(intent)
            } else {
              context.startService(intent)
            }
          } catch (_: IllegalStateException) {
            // Android may already have revoked foreground-service eligibility.
          } catch (_: SecurityException) {
            // A restricted device can deny background execution.
          }
        }
      }
    }

    OnActivityEntersForeground { stopSync() }
    OnDestroy { stopSync() }
  }

  private fun stopSync() {
    appContext.reactContext?.let { context ->
      context.stopService(Intent(context, BackgroundSyncService::class.java))
    }
  }
}

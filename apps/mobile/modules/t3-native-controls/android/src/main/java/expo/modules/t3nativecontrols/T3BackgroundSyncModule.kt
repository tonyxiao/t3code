package expo.modules.t3nativecontrols

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
          BackgroundSyncService.start(context)
        }
      }
    }

    OnActivityEntersForeground { stopSync() }
    OnDestroy {
      enabled = false
      stopSync()
    }
  }

  private fun stopSync() {
    appContext.reactContext?.let { context ->
      BackgroundSyncService.stop(context)
    }
  }
}

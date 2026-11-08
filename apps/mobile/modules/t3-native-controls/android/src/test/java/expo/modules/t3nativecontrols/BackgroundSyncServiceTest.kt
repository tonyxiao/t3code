package expo.modules.t3nativecontrols

import android.app.Service
import android.content.Intent
import com.facebook.react.HeadlessJsTaskService
import java.time.Duration
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowService

// The Android service lifecycle is exercised without starting a React Native runtime.
@Implements(HeadlessJsTaskService::class)
class HeadlessRuntimeShadow : ShadowService() {
  @Implementation
  @Suppress("UnusedParameter")
  fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = Service.START_NOT_STICKY

  @Implementation
  override fun onDestroy() {
    super.onDestroy()
  }
}

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [26, 35], manifest = Config.NONE, shadows = [HeadlessRuntimeShadow::class])
class BackgroundSyncServiceTest {
  @Test
  fun cancellationBeforeCreationStillAcknowledgesTheForegroundStart() {
    val context = RuntimeEnvironment.getApplication()
    BackgroundSyncService.start(context)
    BackgroundSyncService.stop(context)
    assertNull(shadowOf(context).nextStoppedService)

    val controller = Robolectric.buildService(BackgroundSyncService::class.java).create()
    controller.startCommand(0, 1)
    val service = shadowOf(controller.get())

    assertNotNull(service.lastForegroundNotification)
    assertTrue(service.isStoppedBySelf)
    controller.destroy()
  }

  @Test
  fun cancellationOfRepeatedStartWaitsForAcknowledgement() {
    val context = RuntimeEnvironment.getApplication()
    BackgroundSyncService.start(context)
    val controller = Robolectric.buildService(BackgroundSyncService::class.java).create()
    controller.startCommand(0, 1)
    controller.get().stopForeground(Service.STOP_FOREGROUND_REMOVE)

    BackgroundSyncService.start(context)
    BackgroundSyncService.stop(context)
    assertNull(shadowOf(context).nextStoppedService)
    controller.startCommand(0, 2)

    val service = shadowOf(controller.get())
    assertFalse(service.isForegroundStopped)
    assertTrue(service.isStoppedBySelf)
    controller.destroy()
  }

  @Test
  fun foregroundStartIsAcknowledgedAndStopsAfterTenMinutes() {
    val context = RuntimeEnvironment.getApplication()
    BackgroundSyncService.start(context)
    val controller = Robolectric.buildService(BackgroundSyncService::class.java).create()
    controller.startCommand(0, 1)
    val service = shadowOf(controller.get())

    assertNotNull(service.lastForegroundNotification)
    assertFalse(service.isStoppedBySelf)

    shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMinutes(10))
    assertTrue(service.isStoppedBySelf)
    BackgroundSyncService.stop(context)
    controller.destroy()
  }

  @Test
  fun repeatedStartDoesNotExtendTheTenMinuteWindow() {
    val context = RuntimeEnvironment.getApplication()
    BackgroundSyncService.start(context)
    val controller = Robolectric.buildService(BackgroundSyncService::class.java).create()
    controller.startCommand(0, 1)
    val service = shadowOf(controller.get())
    val looper = shadowOf(android.os.Looper.getMainLooper())
    looper.idleFor(Duration.ofMinutes(9))

    BackgroundSyncService.start(context)
    controller.startCommand(0, 2)
    assertFalse(service.isStoppedBySelf)
    looper.idleFor(Duration.ofMinutes(1))

    assertTrue(service.isStoppedBySelf)
    BackgroundSyncService.stop(context)
    controller.destroy()
  }
}

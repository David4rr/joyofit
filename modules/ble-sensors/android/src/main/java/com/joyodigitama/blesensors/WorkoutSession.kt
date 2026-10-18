package com.joyodigitama.blesensors

import android.Manifest
import android.annotation.SuppressLint
import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.util.Log
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.TimeoutCancellationException
import kotlinx.coroutines.withTimeout

/**
 * The phone side of a recorded workout: the [RecordingService] that keeps the process alive, a partial wake lock, and the GPS
 * fixes. Process-wide like [SensorHub], because the service and the recording outlive the JS runtime.
 */
internal object WorkoutSession {
  private const val TAG = "BleSensors"
  private const val WAKE_LOCK_TAG = "joyofit:recording"
  private const val START_TIMEOUT_MS = 10_000L

  class Snapshot(val title: String, val text: String, val gps: Boolean)

  private val lock = Any()

  @Volatile var isActive = false
    private set

  private var title = ""
  private var text = ""
  private var gps = false
  private var wakeLock: PowerManager.WakeLock? = null
  private var location: WorkoutLocation? = null

  /** Completed by the service once `startForeground` succeeded or was refused. */
  @Volatile private var pending: CompletableDeferred<Unit>? = null

  fun snapshot(): Snapshot = synchronized(lock) { Snapshot(title, text, gps) }

  /** Starts the session, or updates the options of a running one. Returns when the service is in the foreground and GPS runs. */
  suspend fun start(context: Context, title: String, text: String, gps: Boolean) {
    if (gps && !hasFineLocation(context)) {
      throw SensorException(ErrorCodes.LOCATION_PERMISSION, "Precise location permission is not granted")
    }
    val types = ForegroundTypes.compute(Build.VERSION.SDK_INT, gps, hasFineLocation(context), hasBluetoothConnect(context))
    if (types == 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
      throw SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "No foreground service type applies: the workout has no GPS and BLUETOOTH_CONNECT is not granted")
    }

    val ready = CompletableDeferred<Unit>()
    val wasActive = synchronized(lock) {
      this.title = title
      this.text = text
      this.gps = gps
      pending = ready
      isActive.also {
        isActive = true
        acquireWakeLock(context)
      }
    }
    try {
      // startForegroundService itself throws when Android 12+ does not allow a start from the background.
      context.startForegroundService(Intent(context, RecordingService::class.java))
      withTimeout(START_TIMEOUT_MS) { ready.await() }
    } catch (e: TimeoutCancellationException) {
      abort(context, wasActive)
      throw SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "The recording service did not start in time", e)
    } catch (e: CancellationException) {
      abort(context, wasActive)
      throw e
    } catch (e: SensorException) {
      abort(context, wasActive)
      throw e
    } catch (e: RuntimeException) {
      // SecurityException, ForegroundServiceStartNotAllowedException and IllegalStateException all end here.
      abort(context, wasActive)
      throw SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "Android refused the recording service: ${e.message}", e)
    }

    val hub = SensorHub.get(context)
    try {
      synchronized(lock) {
        if (gps) {
          (location ?: WorkoutLocation(context, hub).also { location = it }).start()
        } else {
          location?.stop()
        }
      }
    } catch (e: SensorException) {
      abort(context, wasActive)
      throw e
    }
  }

  fun update(context: Context, text: String) {
    val current = synchronized(lock) {
      this.text = text
      if (!isActive) return
      title
    }
    context.getSystemService(NotificationManager::class.java)?.notify(RecordingNotification.ID, RecordingNotification.build(context, current, text))
  }

  /** Stops GPS, the service and the wake lock. Idempotent. */
  fun end(context: Context) {
    synchronized(lock) {
      isActive = false
      location?.stop()
      location = null
      releaseWakeLock()
    }
    context.stopService(Intent(context, RecordingService::class.java))
  }

  fun serviceStarted() {
    pending?.complete(Unit)
  }

  fun serviceFailed(error: RuntimeException) {
    Log.w(TAG, "startForeground failed: ${error.message}")
    pending?.completeExceptionally(SensorException(ErrorCodes.SERVICE_NOT_ALLOWED, "Android refused the foreground service: ${error.message}", error))
  }

  /** A failed update must not take a healthy running session down with it. */
  private fun abort(context: Context, wasActive: Boolean) {
    if (!wasActive) end(context)
  }

  @SuppressLint("WakelockTimeout")
  private fun acquireWakeLock(context: Context) {
    if (wakeLock?.isHeld == true) return
    val manager = context.getSystemService(PowerManager::class.java) ?: return
    wakeLock = manager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, WAKE_LOCK_TAG).apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  private fun releaseWakeLock() {
    val held = wakeLock
    wakeLock = null
    if (held?.isHeld == true) held.release()
  }

  private fun hasFineLocation(context: Context) =
    context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

  private fun hasBluetoothConnect(context: Context) =
    Build.VERSION.SDK_INT < Build.VERSION_CODES.S || context.checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED
}

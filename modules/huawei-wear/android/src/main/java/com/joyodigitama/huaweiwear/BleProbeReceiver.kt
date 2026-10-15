package com.joyodigitama.huaweiwear

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import kotlinx.coroutines.launch

/**
 * Developer probe for the Bluetooth LE link, driven from a computer without touching the app:
 *
 *   adb shell am broadcast -n com.joyodigitama.joyofit/com.joyodigitama.huaweiwear.BleProbeReceiver \
 *     -a com.joyodigitama.joyofit.BLE_PROBE [--es address AA:BB:CC:DD:EE:FF] [--ez sync false] [--ez restore false]
 *
 * It pauses the background link, connects to the remembered (or given) watch over LE GATT (the developer switch's transport),
 * reads the battery and, unless `sync` is false, runs an activity sync (steps), then disconnects and restores the switch and
 * the background link (unless `restore` is false). Every step is logged under the JoyoFitBle logcat tag.
 *
 * The manifest requires android.permission.DUMP, which only the adb shell and the system hold, so no other app can send it.
 */
class BleProbeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    val runtime = WearRuntime.get(context)
    val address = intent.getStringExtra("address") ?: runtime.settings.watchAddress
    if (address == null) {
      Log.e(TAG, "probe: no address given and no remembered watch")
      return
    }
    val sync = intent.getBooleanExtra("sync", true)
    val restore = intent.getBooleanExtra("restore", true)
    runtime.scope.launch { probe(runtime, address, sync, restore) }
  }

  private suspend fun probe(runtime: WearRuntime, address: String, sync: Boolean, restore: Boolean) {
    val link = runtime.link
    val previousForce = runtime.settings.forceBle
    val wasPaused = runtime.backgroundStatus()["paused"] == true
    Log.i(TAG, "probe: start, address $address, sync $sync, restore $restore, previous LE switch $previousForce")
    try {
      runtime.setForceBle(true)
      runtime.disconnectFromApp()
      val info = runtime.connectFromApp(address)
      Log.i(TAG, "probe: CONNECTED over LE: $info")
      val battery = link.refreshBattery()
      Log.i(TAG, "probe: BATTERY $battery%")
      if (sync) {
        val summary = link.syncActivity()
        Log.i(TAG, "probe: SYNC OK: ${summary.toJs()}")
      }
      Log.i(TAG, "probe: RESULT success")
    } catch (e: WearException) {
      Log.e(TAG, "probe: RESULT failed [${e.errorCode}]: ${e.message}", e)
    } catch (e: Exception) {
      Log.e(TAG, "probe: RESULT failed: ${e.javaClass.simpleName}: ${e.message}", e)
    } finally {
      if (restore) {
        if (wasPaused) runtime.disconnectFromApp() else link.disconnect()
        runtime.setForceBle(previousForce)
        Log.i(TAG, "probe: restored LE switch $previousForce, background link ${if (wasPaused) "still paused" else "resumes"}")
      }
    }
  }

  private companion object {
    const val ACTION = "com.joyodigitama.joyofit.BLE_PROBE"
    const val TAG = "JoyoFitBle"
  }
}

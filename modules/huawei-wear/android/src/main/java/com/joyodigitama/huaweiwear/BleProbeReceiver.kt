package com.joyodigitama.huaweiwear

import android.annotation.SuppressLint
import android.bluetooth.BluetoothManager
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import android.os.PowerManager
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/**
 * Developer probe for the Bluetooth LE link, driven from a computer without touching the app:
 *
 *   adb shell am broadcast -n com.joyodigitama.joyofit/com.joyodigitama.huaweiwear.BleProbeReceiver \
 *     -a com.joyodigitama.joyofit.BLE_PROBE [--es address AA:BB:CC:DD:EE:FF] [--ez sync false] [--ez restore false]
 *
 * `--ez force true|false` only sets the developer LE switch and does nothing else.
 *
 * With `--ei scan SECONDS` it only runs an unfiltered LE scan (screen on, BLUETOOTH_SCAN granted) and logs every advertiser once with
 * its name, address, services, manufacturer ids and raw advertising bytes, to see what the watch advertises.
 *
 * It pauses the background link, connects to the remembered (or given) watch over LE GATT (the developer switch's transport),
 * reads the battery and, unless `sync` is false, runs an activity sync (steps), then disconnects and restores the switch and
 * the background link (unless `restore` is false). Every step is logged under the JoyoFitBle logcat tag.
 *
 * With `--es lab TAG [--es stop negotiation|pin|step2] [--ez commit true] [--ez adopt true] [--ei linkslice N] [--ei linkmtu N]` it runs
 * the [BindLab] instead: a throwaway client identity (`real` is the stored one, which only reconnects) that authenticates over LE GATT,
 * to see what a phone that never bound before gets from the watch. `linkslice` and `linkmtu` fill those numbers into the LinkParams request.
 *
 * The manifest requires android.permission.DUMP, which only the adb shell and the system hold, so no other app can send it.
 */
class BleProbeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != ACTION) return
    val runtime = WearRuntime.get(context)
    if (intent.hasExtra("force")) {
      runtime.setForceBle(intent.getBooleanExtra("force", false))
      Log.i(TAG, "probe: LE switch set to ${runtime.settings.forceBle}")
      return
    }
    val address = intent.getStringExtra("address") ?: runtime.settings.watchAddress
    if (address == null) {
      Log.e(TAG, "probe: no address given and no remembered watch")
      return
    }
    val sync = intent.getBooleanExtra("sync", true)
    val restore = intent.getBooleanExtra("restore", true)
    val labTag = intent.getStringExtra("lab")
    if (labTag != null) {
      val stop = when (val name = intent.getStringExtra("stop")) {
        null -> null
        "negotiation" -> BindStop.SECURITY_NEGOTIATION
        "pin" -> BindStop.PIN_CODE
        "step2" -> BindStop.ISO_MAC_VERIFIED
        else -> {
          Log.e(TAG, "lab: unknown stop '$name', use negotiation, pin or step2")
          return
        }
      }
      val commit = intent.getBooleanExtra("commit", false)
      val adopt = intent.getBooleanExtra("adopt", false)
      val linkSlice = if (intent.hasExtra("linkslice")) intent.getIntExtra("linkslice", 0) else null
      val linkMtu = if (intent.hasExtra("linkmtu")) intent.getIntExtra("linkmtu", 0) else null
      runtime.scope.launch { BindLab.run(runtime, address, labTag, AuthLab(stop, linkSlice, linkMtu), commit, adopt) }
      return
    }
    val scanSeconds = intent.getIntExtra("scan", 0)
    runtime.scope.launch { if (scanSeconds > 0) scan(context, address, scanSeconds) else probe(runtime, address, sync, restore) }
  }

  @SuppressLint("MissingPermission")
  private suspend fun scan(context: Context, address: String, seconds: Int) {
    val scanner = context.getSystemService(BluetoothManager::class.java)?.adapter?.bluetoothLeScanner
    if (scanner == null) {
      Log.e(TAG, "scan: no LE scanner")
      return
    }
    val seen = ConcurrentHashMap.newKeySet<String>()
    val callback = object : ScanCallback() {
      override fun onScanResult(callbackType: Int, result: ScanResult) {
        val record = result.scanRecord
        val line = "${result.device.address} name \"${record?.deviceName}\" rssi ${result.rssi} connectable ${result.isConnectable} " +
          "uuids ${record?.serviceUuids} serviceData ${record?.serviceData?.keys} " +
          "mfr ${(0 until (record?.manufacturerSpecificData?.size() ?: 0)).map { "0x%04x".format(record!!.manufacturerSpecificData.keyAt(it)) }} " +
          "raw ${record?.bytes?.joinToString("") { "%02x".format(it) }}"
        if (seen.add(line.substringBefore(" rssi"))) {
          val mine = result.device.address.equals(address, ignoreCase = true)
          Log.i(TAG, "scan: ${if (mine) "*** WATCH ADDRESS *** " else ""}$line")
        }
      }

      override fun onScanFailed(errorCode: Int) {
        Log.e(TAG, "scan: failed, error $errorCode")
      }
    }
    Log.i(TAG, "scan: unfiltered LE scan for $seconds s, looking for $address")
    // Android pauses unfiltered scans while the screen is off, so the screen is held on for the scan.
    @Suppress("DEPRECATION")
    val screen = context.getSystemService(PowerManager::class.java)
      .newWakeLock(PowerManager.SCREEN_DIM_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP, "JoyoFit:ble-scan")
    screen.acquire((seconds + 5) * 1000L)
    scanner.startScan(null, ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(), callback)
    delay(seconds * 1000L)
    scanner.stopScan(callback)
    if (screen.isHeld) screen.release()
    Log.i(TAG, "scan: done, ${seen.size} distinct advertisers")
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
        // The switch goes back first: the background loop reconnects the moment the link drops and must then pick the model's own link.
        runtime.setForceBle(previousForce)
        if (wasPaused) runtime.disconnectFromApp() else link.disconnect()
        Log.i(TAG, "probe: restored LE switch $previousForce, background link ${if (wasPaused) "still paused" else "resumes"}")
      }
    }
  }

  private companion object {
    const val ACTION = "com.joyodigitama.joyofit.BLE_PROBE"
    const val TAG = "JoyoFitBle"
  }
}

package com.watchfitre.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import com.watchfitre.ble.model.BleDevice
import com.watchfitre.di.AppModule.ApplicationScope
import com.watchfitre.log.PacketDirection
import com.watchfitre.log.PacketLogger
import com.watchfitre.log.PacketLogEntry
import com.watchfitre.log.PacketOp
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import javax.inject.Inject
import javax.inject.Singleton

/**
 * BLE scanner. Low-latency, 10s auto-stop, optional name filter. Updates a [StateFlow] of
 * latest-per-address devices; emits every scan result to [PacketLogger].
 */
@Singleton
class BleScanner @Inject constructor(
    private val adapter: BluetoothAdapter?,
    private val logger: PacketLogger,
    @ApplicationScope private val scope: CoroutineScope,
) {

    private val _devices = MutableStateFlow<List<BleDevice>>(emptyList())
    val devices: StateFlow<List<BleDevice>> = _devices.asStateFlow()

    private val _scanning = MutableStateFlow(false)
    val scanning: StateFlow<Boolean> = _scanning.asStateFlow()

    private var timeoutJob: Job? = null
    private val seen = LinkedHashMap<String, BleDevice>()

    private val callback = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            val device = result.toBleDevice()
            seen[device.address] = device
            _devices.value = seen.values.sortedByDescending { it.rssi }
            logger.log(
                PacketLogEntry(
                    epochMs = System.currentTimeMillis(),
                    direction = PacketDirection.RX,
                    op = PacketOp.SCAN_RESULT,
                    serviceUuid = null,
                    characteristicUuid = null,
                    payload = ByteArray(0),
                    rssi = result.rssi,
                )
            )
        }

        override fun onScanFailed(errorCode: Int) {
            _scanning.value = false
        }
    }

    fun start(timeoutMs: Long = DEFAULT_TIMEOUT_MS) {
        val scanner = adapter?.bluetoothLeScanner
        if (scanner == null) {
            _scanning.value = false
            return
        }
        seen.clear()
        _devices.value = emptyList()
        _scanning.value = true
        try {
            scanner.startScan(
                emptyList(),
                ScanSettings.Builder()
                    .setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY)
                    .setCallbackType(ScanSettings.CALLBACK_TYPE_ALL_MATCHES)
                    .build(),
                callback,
            )
        } catch (_: SecurityException) {
            // Caller should have gated on permissions; fail quietly if not.
            _scanning.value = false
            return
        }
        timeoutJob?.cancel()
        timeoutJob = scope.launch {
            delay(timeoutMs)
            stop()
        }
    }

    fun stop() {
        timeoutJob?.cancel()
        val scanner = adapter?.bluetoothLeScanner ?: run {
            _scanning.value = false
            return
        }
        try {
            scanner.stopScan(callback)
        } catch (_: SecurityException) {
        }
        _scanning.value = false
    }

    private fun ScanResult.toBleDevice(): BleDevice {
        val name: String? = try {
            scanRecord?.deviceName ?: device?.name
        } catch (_: SecurityException) {
            null
        }
        return BleDevice(
            address = device.address,
            name = name,
            rssi = rssi,
            timestampMs = System.currentTimeMillis(),
        )
    }

    companion object {
        const val DEFAULT_TIMEOUT_MS = 10_000L
        const val NAME_HINT_WATCH = "Watch Fit"
    }
}

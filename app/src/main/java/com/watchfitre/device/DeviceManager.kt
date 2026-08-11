package com.watchfitre.device

import com.watchfitre.ble.BleConnectionManager
import com.watchfitre.ble.BleGattManager
import com.watchfitre.ble.BleIoManager
import com.watchfitre.ble.model.GattCharacteristicInfo
import com.watchfitre.ble.model.GattServiceInfo
import com.watchfitre.ble.model.GattUuid
import com.watchfitre.di.AppModule.ApplicationScope
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Reads standard SIG GATT characteristics (battery, device information) and exposes a
 * [DeviceInfo] flow. v0.2 scope (PRD §15). Proprietary fields stay null until their
 * characteristics are VERIFIED.
 *
 * The reads themselves are async BLE ops; results land in the GATT tree's `lastValue` (set by
 * the connection callback). This manager merely re-derives [DeviceInfo] whenever the tree
 * changes and triggers a fresh read batch via [refresh].
 */
@Singleton
class DeviceManager @Inject constructor(
    private val connection: BleConnectionManager,
    private val gatt: BleGattManager,
    private val io: BleIoManager,
    @ApplicationScope private val scope: CoroutineScope,
) {

    val deviceInfo: StateFlow<DeviceInfo> = gatt.services
        .map { decode(it) }
        .stateIn(scope, SharingStarted.WhileSubscribed(5_000), DeviceInfo())

    fun isReady(): Boolean = connection.state.value.isConnected()

    /**
     * Fire reads for every standard characteristic the connected watch actually exposes.
     * Characteristics not present are skipped silently. Returns the count dispatched.
     */
    fun refresh(): Int {
        if (!isReady()) return 0
        var dispatched = 0
        STANDARD_CHARS.forEach { uuid ->
            if (hasCharacteristic(uuid)) {
                if (io.read(uuid)) dispatched++
            }
        }
        return dispatched
    }

    private fun hasCharacteristic(uuid: UUID): Boolean =
        gatt.services.value.any { svc -> svc.characteristics.any { it.uuid.equals(uuid.toString(), true) } }

    private fun decode(services: List<GattServiceInfo>): DeviceInfo {
        val battery = value(services, GattUuid.BATTERY_LEVEL)?.firstOrNull()?.let { it.toInt() and 0xFF }
        return DeviceInfo(
            batteryPct = battery?.takeIf { it in 0..100 },
            name = value(services, GattUuid.DEVICE_NAME)?.toUtf8(),
            model = value(services, GattUuid.MODEL_NUMBER)?.toUtf8(),
            firmware = value(services, GattUuid.FIRMWARE_REVISION)?.toUtf8(),
            hardware = value(services, GattUuid.HARDWARE_REVISION)?.toUtf8(),
            manufacturer = value(services, GattUuid.MANUFACTURER_NAME)?.toUtf8(),
            serial = value(services, GattUuid.SERIAL_NUMBER)?.toUtf8(),
        )
    }

    private fun value(services: List<GattServiceInfo>, uuid: UUID): ByteArray? =
        services.firstNotNullOfOrNull { svc ->
            svc.characteristics.firstOrNull { it.uuid.equals(uuid.toString(), true) }?.lastValue
        }

    private fun ByteArray.toUtf8(): String = String(this, Charsets.UTF_8).trimEnd { it == 0.toChar() }

    companion object {
        /** Standard characteristics we attempt to read. */
        val STANDARD_CHARS: List<UUID> = listOf(
            GattUuid.BATTERY_LEVEL,
            GattUuid.DEVICE_NAME,
            GattUuid.MODEL_NUMBER,
            GattUuid.FIRMWARE_REVISION,
            GattUuid.HARDWARE_REVISION,
            GattUuid.MANUFACTURER_NAME,
            GattUuid.SERIAL_NUMBER,
        )
    }
}

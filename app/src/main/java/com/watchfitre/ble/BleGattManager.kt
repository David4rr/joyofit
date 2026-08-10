package com.watchfitre.ble

import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattService
import com.watchfitre.ble.model.CharProperty
import com.watchfitre.ble.model.GattCharacteristicInfo
import com.watchfitre.ble.model.GattDescriptorInfo
import com.watchfitre.ble.model.GattServiceInfo
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Owns the discovered GATT tree as a [StateFlow] of immutable snapshots. No Android
 * BluetoothGatt references here — purely the decoded view, so the UI never blocks on the
 * transport and tests can construct trees directly.
 */
@Singleton
class BleGattManager @Inject constructor() {

    private val _services = MutableStateFlow<List<GattServiceInfo>>(emptyList())
    val services: StateFlow<List<GattServiceInfo>> = _services.asStateFlow()

    fun setServices(gatt: BluetoothGatt) {
        _services.value = gatt.services.map { it.toInfo() }
    }

    fun clear() {
        _services.value = emptyList()
    }

    /** Find the live characteristic handle for a UUID (first match across services). */
    fun findCharacteristic(gatt: BluetoothGatt, uuid: UUID): BluetoothGattCharacteristic? =
        gatt.services.firstNotNullOfOrNull { service ->
            service.characteristics.firstOrNull { it.uuid == uuid }
        }

    fun findServiceFor(gatt: BluetoothGatt, charUuid: UUID): BluetoothGattService? =
        gatt.services.firstOrNull { s -> s.characteristics.any { it.uuid == charUuid } }

    fun markValue(charUuid: UUID, value: ByteArray) {
        val updated = _services.value.map { svc ->
            svc.copy(characteristics = svc.characteristics.map { ch ->
                if (ch.uuid.equals(charUuid.toString(), ignoreCase = true)) {
                    ch.also { it.lastValue = value }
                } else ch
            })
        }
        _services.value = updated
    }

    fun markSubscribed(charUuid: UUID, enabled: Boolean) {
        val updated = _services.value.map { svc ->
            svc.copy(characteristics = svc.characteristics.map { ch ->
                if (ch.uuid.equals(charUuid.toString(), ignoreCase = true)) {
                    ch.also { it.subscribed = enabled }
                } else ch
            })
        }
        _services.value = updated
    }

    private fun BluetoothGattService.toInfo(): GattServiceInfo =
        GattServiceInfo(
            uuid = uuid.toString(),
            instanceId = instanceId,
            characteristics = characteristics.map { it.toInfo() },
        )

    private fun BluetoothGattCharacteristic.toInfo(): GattCharacteristicInfo {
        val props = decodeProperties(properties)
        return GattCharacteristicInfo(
            uuid = uuid.toString(),
            instanceId = instanceId,
            properties = props,
            descriptors = descriptors.map { GattDescriptorInfo(it.uuid.toString()) },
            canRead = CharProperty.READ in props,
            canWrite = CharProperty.WRITE in props || CharProperty.SIGNED_WRITE in props,
            canWriteNoResponse = CharProperty.WRITE_NO_RESPONSE in props,
            canNotify = CharProperty.NOTIFY in props,
            canIndicate = CharProperty.INDICATE in props,
        )
    }

    private fun decodeProperties(p: Int): Set<CharProperty> = buildSet {
        if (p and BluetoothGattCharacteristic.PROPERTY_BROADCAST != 0) add(CharProperty.BROADCAST)
        if (p and BluetoothGattCharacteristic.PROPERTY_READ != 0) add(CharProperty.READ)
        if (p and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) add(CharProperty.WRITE_NO_RESPONSE)
        if (p and BluetoothGattCharacteristic.PROPERTY_WRITE != 0) add(CharProperty.WRITE)
        if (p and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0) add(CharProperty.NOTIFY)
        if (p and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0) add(CharProperty.INDICATE)
        if (p and BluetoothGattCharacteristic.PROPERTY_SIGNED_WRITE != 0) add(CharProperty.SIGNED_WRITE)
        if (p and BluetoothGattCharacteristic.PROPERTY_EXTENDED_PROPS != 0) add(CharProperty.EXTENDED_PROPS)
    }
}

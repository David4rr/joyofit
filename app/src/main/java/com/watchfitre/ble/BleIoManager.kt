package com.watchfitre.ble

import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import com.watchfitre.ble.model.GattCharacteristicInfo
import com.watchfitre.ble.model.GattUuid
import com.watchfitre.log.PacketDirection
import com.watchfitre.log.PacketLogger
import com.watchfitre.log.PacketLogEntry
import com.watchfitre.log.PacketOp
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Performs read / write / notify- subscribe operations against the live GATT handle held by
 * [connectionManager]. Each request also logs a TX entry immediately so the user sees intent
 * even before the confirmation callback.
 *
 * Returns true if the underlying call was dispatched; false if preconditions failed
 * (no gatt, char not found, missing property). Never throws on a missing permission — the
 * caller gates on permissions first.
 */
@Singleton
class BleIoManager @Inject constructor(
    private val connectionManager: BleConnectionManager,
    private val gattManager: BleGattManager,
    private val logger: PacketLogger,
) {

    fun read(charUuid: UUID): Boolean {
        val gatt = connectionManager.currentGatt ?: return false
        val char = gattManager.findCharacteristic(gatt, charUuid) ?: return false
        if (char.properties and BluetoothGattCharacteristic.PROPERTY_READ == 0) return false
        logTx(PacketOp.READ, char, ByteArray(0))
        return tryOp { gatt.readCharacteristic(char) }
    }

    fun write(charUuid: UUID, payload: ByteArray): Boolean {
        val gatt = connectionManager.currentGatt ?: return false
        val char = gattManager.findCharacteristic(gatt, charUuid) ?: return false
        val writeType = if (char.properties and BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE != 0) {
            BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
        } else {
            BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
        }
        char.writeType = writeType
        char.value = payload
        logTx(PacketOp.WRITE, char, payload)
        return tryOp { gatt.writeCharacteristic(char) }
    }

    /**
     * Enable / disable notifications (or indications) by writing the CCCD.
     * Picks indication when only INDICATE is supported.
     */
    fun setNotify(charUuid: UUID, enable: Boolean): Boolean {
        val gatt = connectionManager.currentGatt ?: return false
        val char = gattManager.findCharacteristic(gatt, charUuid) ?: return false

        val supportsNotify = char.properties and BluetoothGattCharacteristic.PROPERTY_NOTIFY != 0
        val supportsIndicate = char.properties and BluetoothGattCharacteristic.PROPERTY_INDICATE != 0
        if (!supportsNotify && !supportsIndicate) return false

        val ok = tryOp {
            gatt.setCharacteristicNotification(char, enable)
        }
        if (!ok) return false

        val cccd = char.getDescriptor(GattUuid.CCCD) ?: run {
            gattManager.markSubscribed(charUuid, enable)
            return true
        }
        val flag: Int = when {
            enable && supportsIndicate -> BluetoothGattDescriptor.ENABLE_INDICATION_VALUE
            enable -> BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
            else -> BluetoothGattDescriptor.DISABLE_NOTIFICATION_VALUE
        }
        cccd.value = flag
        gattManager.markSubscribed(charUuid, enable)
        return tryOp { gatt.writeDescriptor(cccd) }
    }

    fun readRssi(): Boolean {
        val gatt = connectionManager.currentGatt ?: return false
        return tryOp { gatt.readRemoteRssi() }
    }

    private fun logTx(op: PacketOp, char: BluetoothGattCharacteristic, payload: ByteArray) {
        logger.log(
            PacketLogEntry(
                epochMs = System.currentTimeMillis(),
                direction = PacketDirection.TX,
                op = op,
                serviceUuid = char.service?.uuid?.toString(),
                characteristicUuid = char.uuid.toString(),
                payload = payload,
            )
        )
    }

    private inline fun tryOp(block: () -> Boolean): Boolean =
        try {
            block()
        } catch (_: SecurityException) {
            false
        }
}

/** Summarize a characteristic's capabilities in one string for the UI. */
fun GattCharacteristicInfo.capabilitySummary(): String =
    buildList {
        if (canRead) add("READ")
        if (canWrite) add("WRITE")
        if (canWriteNoResponse) add("WRITE_NR")
        if (canNotify) add("NOTIFY")
        if (canIndicate) add("INDICATE")
    }.joinToString(" ").ifEmpty { "—" }

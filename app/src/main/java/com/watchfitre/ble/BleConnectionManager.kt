package com.watchfitre.ble

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothProfile
import android.content.Context
import com.watchfitre.ble.model.ConnectionState
import com.watchfitre.di.AppModule.ApplicationScope
import com.watchfitre.log.PacketDirection
import com.watchfitre.log.PacketLogger
import com.watchfitre.log.PacketLogEntry
import com.watchfitre.log.PacketOp
import com.watchfitre.settings.SettingsRepository
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import java.util.UUID
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Owns the live [BluetoothGatt] + the single [BluetoothGattCallback]. All async GATT events
 * (connection, services discovered, read/write confirmations, notifications, rssi) flow
 * through here, update [state], rebuild the tree via [gattManager], and feed [logger].
 *
 * Single-writer for [currentGatt]; all access from the main thread (Android BLE requirement).
 */
@Singleton
class BleConnectionManager @Inject constructor(
    private val adapter: BluetoothAdapter?,
    private val gattManager: BleGattManager,
    private val logger: PacketLogger,
    private val settings: SettingsRepository,
    @ApplicationContext private val context: Context,
    @ApplicationScope private val scope: CoroutineScope,
) {

    private val _state = MutableStateFlow<ConnectionState>(ConnectionState.Disconnected)
    val state: StateFlow<ConnectionState> = _state.asStateFlow()

    /** Current live GATT handle, or null. Read on the main thread only. */
    @Volatile
    var currentGatt: BluetoothGatt? = null
        private set

    private val callback = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            when (newState) {
                BluetoothProfile.STATE_CONNECTED -> {
                    _state.value = ConnectionState.DiscoveringServices
                    try {
                        gatt.discoverServices()
                    } catch (_: SecurityException) {
                        _state.value = ConnectionState.Failed("Permission revoked during connect")
                    }
                    logger.log(meta(PacketDirection.TX, PacketOp.CONNECT, status, ByteArray(0)))
                }
                BluetoothProfile.STATE_DISCONNECTED -> {
                    _state.value = ConnectionState.Disconnected
                    gattManager.clear()
                    gatt.close()
                    currentGatt = null
                    logger.log(meta(PacketDirection.RX, PacketOp.DISCONNECT, status, ByteArray(0)))
                }
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            gattManager.setServices(gatt)
            _state.value = ConnectionState.Ready(gatt.device.address)
            scope.launch {
                settings.setLastDevice(gatt.device.address, gatt.device.nameSafe())
            }
            logger.log(meta(PacketDirection.RX, PacketOp.SERVICE_DISCOVERY, status, ByteArray(0)))
        }

        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
            status: Int,
        ) {
            handleCharacteristicRead(characteristic, value, status)
        }

        @Deprecated("Pre-API-33 overload. Still fired on API 29-32.", ReplaceWith("onCharacteristicRead(gatt, characteristic, value, status)"))
        @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
        override fun onCharacteristicRead(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int,
        ) {
            handleCharacteristicRead(characteristic, characteristic.value ?: ByteArray(0), status)
        }

        @Suppress("DEPRECATION") // characteristic.value: the 3-arg value overload is API 33+; we support 29-32.
        override fun onCharacteristicWrite(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            status: Int,
        ) {
            logger.log(
                PacketLogEntry(
                    epochMs = System.currentTimeMillis(),
                    direction = PacketDirection.TX,
                    op = PacketOp.WRITE,
                    serviceUuid = characteristic.service?.uuid?.toString(),
                    characteristicUuid = characteristic.uuid.toString(),
                    payload = characteristic.value ?: ByteArray(0),
                    gattStatus = status,
                )
            )
        }

        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            handleCharacteristicChanged(characteristic, value)
        }

        @Deprecated("Pre-API-33 overload. Still fired on API 29-32.")
        @Suppress("DEPRECATION", "OVERRIDE_DEPRECATION")
        override fun onCharacteristicChanged(
            gatt: BluetoothGatt,
            characteristic: BluetoothGattCharacteristic,
        ) {
            handleCharacteristicChanged(characteristic, characteristic.value ?: ByteArray(0))
        }

        override fun onReadRemoteRssi(gatt: BluetoothGatt, rssi: Int, status: Int) {
            logger.log(
                PacketLogEntry(
                    epochMs = System.currentTimeMillis(),
                    direction = PacketDirection.RX,
                    op = PacketOp.RSSI,
                    serviceUuid = null,
                    characteristicUuid = null,
                    payload = ByteArray(0),
                    gattStatus = status,
                    rssi = rssi,
                )
            )
        }

        private fun handleCharacteristicRead(
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
            status: Int,
        ) {
            gattManager.markValue(characteristic.uuid, value)
            logger.log(
                PacketLogEntry(
                    epochMs = System.currentTimeMillis(),
                    direction = PacketDirection.RX,
                    op = PacketOp.READ,
                    serviceUuid = characteristic.service?.uuid?.toString(),
                    characteristicUuid = characteristic.uuid.toString(),
                    payload = value,
                    gattStatus = status,
                )
            )
        }

        private fun handleCharacteristicChanged(
            characteristic: BluetoothGattCharacteristic,
            value: ByteArray,
        ) {
            gattManager.markValue(characteristic.uuid, value)
            logger.log(
                PacketLogEntry(
                    epochMs = System.currentTimeMillis(),
                    direction = PacketDirection.RX,
                    op = PacketOp.NOTIFY,
                    serviceUuid = characteristic.service?.uuid?.toString(),
                    characteristicUuid = characteristic.uuid.toString(),
                    payload = value,
                )
            )
        }
    }

    fun connect(device: BluetoothDevice) {
        if (adapter == null) {
            _state.value = ConnectionState.Failed("Bluetooth unavailable")
            return
        }
        disconnect()
        _state.value = ConnectionState.Connecting(device.address)
        try {
            currentGatt = device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
        } catch (e: SecurityException) {
            _state.value = ConnectionState.Failed("Connect permission denied")
        }
    }

    fun disconnect() {
        val gatt = currentGatt ?: run {
            _state.value = ConnectionState.Disconnected
            return
        }
        try {
            gatt.disconnect()
        } catch (_: SecurityException) {
        }
        // onConnectionStateChange will close + clear; defensive fallback if callback never fires:
        gattManager.clear()
        currentGatt = null
    }

    private fun meta(
        direction: PacketDirection,
        op: PacketOp,
        status: Int,
        payload: ByteArray,
    ) = PacketLogEntry(
        epochMs = System.currentTimeMillis(),
        direction = direction,
        op = op,
        serviceUuid = null,
        characteristicUuid = null,
        payload = payload,
        gattStatus = status,
    )

    private fun BluetoothDevice.nameSafe(): String? = try { name } catch (_: SecurityException) { null }

    companion object {
        @JvmField val CCCD_UUID: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }
}

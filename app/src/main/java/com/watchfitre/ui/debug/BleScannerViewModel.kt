package com.watchfitre.ui.debug

import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.watchfitre.ble.BleConnectionManager
import com.watchfitre.ble.BleScanner
import com.watchfitre.ble.model.BleDevice
import com.watchfitre.ble.model.ConnectionState
import com.watchfitre.settings.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class BleScannerViewModel @Inject constructor(
    private val scanner: BleScanner,
    private val connection: BleConnectionManager,
    private val adapter: BluetoothAdapter?,
    val settings: SettingsRepository,
) : ViewModel() {

    data class ScanUi(
        val scanning: Boolean,
        val devices: List<BleDevice>,
        val connection: ConnectionState,
    )

    val ui: StateFlow<ScanUi> = combine(
        scanner.scanning,
        scanner.devices,
        connection.state,
    ) { scanning, devices, conn ->
        ScanUi(scanning, devices, conn)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = ScanUi(false, emptyList(), ConnectionState.Disconnected),
    )

    fun startScan() = scanner.start()
    fun stopScan() = scanner.stop()

    /** Resolve scanned address to a [BluetoothDevice] and hand to the connection manager. */
    fun connectByAddress(address: String) {
        val ada = adapter ?: return
        val device: BluetoothDevice = try {
            ada.getRemoteDevice(address)
        } catch (_: IllegalArgumentException) {
            return
        } catch (_: SecurityException) {
            return
        }
        scanner.stop()
        connection.connect(device)
    }

    override fun onCleared() {
        scanner.stop()
    }
}

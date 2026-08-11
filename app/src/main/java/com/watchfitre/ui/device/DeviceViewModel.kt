package com.watchfitre.ui.device

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.watchfitre.ble.BleConnectionManager
import com.watchfitre.ble.model.ConnectionState
import com.watchfitre.device.DeviceInfo
import com.watchfitre.device.DeviceManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class DeviceViewModel @Inject constructor(
    private val connection: BleConnectionManager,
    private val deviceManager: DeviceManager,
) : ViewModel() {

    data class DeviceUi(
        val connection: ConnectionState,
        val info: DeviceInfo,
    )

    val ui: StateFlow<DeviceUi> = combine(
        connection.state,
        deviceManager.deviceInfo,
    ) { conn, info -> DeviceUi(conn, info) }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = DeviceUi(ConnectionState.Disconnected, DeviceInfo()),
    )

    /** Returns number of standard reads dispatched (0 if not connected). */
    fun refresh(): Int = deviceManager.refresh()
}

package com.watchfitre.ui.debug

import androidx.lifecycle.ViewModel
import com.watchfitre.ble.BleConnectionManager
import com.watchfitre.ble.BleGattManager
import com.watchfitre.ble.BleIoManager
import com.watchfitre.ble.model.ConnectionState
import com.watchfitre.ble.model.GattServiceInfo
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import androidx.lifecycle.viewModelScope
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class GattExplorerViewModel @Inject constructor(
    private val connection: BleConnectionManager,
    private val gatt: BleGattManager,
    private val io: BleIoManager,
) : ViewModel() {

    data class GattUi(
        val connection: ConnectionState,
        val services: List<GattServiceInfo>,
    )

    val ui: StateFlow<GattUi> = combine(
        connection.state,
        gatt.services,
    ) { conn, svcs ->
        GattUi(conn, svcs)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = GattUi(ConnectionState.Disconnected, emptyList()),
    )

    fun read(uuid: UUID): Boolean = io.read(uuid)
    fun write(uuid: UUID, payload: ByteArray): Boolean = io.write(uuid, payload)
    fun setNotify(uuid: UUID, enable: Boolean): Boolean = io.setNotify(uuid, enable)
    fun readRssi(): Boolean = io.readRssi()
    fun disconnect() = connection.disconnect()
}

package com.watchfitre.ui.debug

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.watchfitre.ble.BleConnectionManager
import com.watchfitre.ble.BleGattManager
import com.watchfitre.ble.BleIoManager
import com.watchfitre.ble.GattMarkdownFormatter
import com.watchfitre.ble.capabilitySummary
import com.watchfitre.ble.model.ConnectionState
import com.watchfitre.ble.model.GattServiceInfo
import com.watchfitre.settings.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import java.util.UUID
import javax.inject.Inject

@HiltViewModel
class GattExplorerViewModel @Inject constructor(
    private val connection: BleConnectionManager,
    private val gatt: BleGattManager,
    private val io: BleIoManager,
    private val settings: SettingsRepository,
) : ViewModel() {

    data class GattUi(
        val connection: ConnectionState,
        val services: List<GattServiceInfo>,
        val deviceLabel: String?,
    )

    val ui: StateFlow<GattUi> = combine(
        connection.state,
        gatt.services,
        settings.settings,
    ) { conn, svcs, s ->
        GattUi(conn, svcs, s.lastDeviceName)
    }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = GattUi(ConnectionState.Disconnected, emptyList(), null),
    )

    fun read(uuid: UUID): Boolean = io.read(uuid)
    fun write(uuid: UUID, payload: ByteArray): Boolean = io.write(uuid, payload)
    fun setNotify(uuid: UUID, enable: Boolean): Boolean = io.setNotify(uuid, enable)
    fun readRssi(): Boolean = io.readRssi()
    fun disconnect() = connection.disconnect()

    /** Markdown snapshot of the current tree (PRD §13). Caller writes + shares the file. */
    fun exportMarkdown(): String {
        val u = ui.value
        return GattMarkdownFormatter.format(u.services, u.deviceLabel, System.currentTimeMillis())
    }

    @Suppress("unused") // capabilitySummary is surfaced for future per-row rendering.
    fun summary() = ui.value.services.flatMap { it.characteristics }.associate { it.uuid to it.capabilitySummary() }
}

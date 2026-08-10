package com.watchfitre.ui.dashboard

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.watchfitre.ble.BleConnectionManager
import com.watchfitre.ble.model.ConnectionState
import com.watchfitre.settings.AppSettings
import com.watchfitre.settings.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.stateIn
import javax.inject.Inject

@HiltViewModel
class DashboardViewModel @Inject constructor(
    settings: SettingsRepository,
    private val connection: BleConnectionManager,
) : ViewModel() {

    data class DashUi(
        val settings: AppSettings = AppSettings(),
        val connection: ConnectionState = ConnectionState.Disconnected,
    )

    val ui: StateFlow<DashUi> = combine(
        settings.settings,
        connection.state,
    ) { s, c -> DashUi(s, c) }.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = DashUi(),
    )
}

package com.watchfitre.ui.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.watchfitre.settings.AppSettings
import com.watchfitre.settings.SettingsRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val repo: SettingsRepository,
) : ViewModel() {

    val settings: StateFlow<AppSettings> = repo.settings.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5_000),
        initialValue = AppSettings(),
    )

    fun enableDebug() = viewModelScope.launch { repo.setDebugEnabled(true) }
    fun disableDebug() = viewModelScope.launch { repo.setDebugEnabled(false) }
    fun setAutoReconnect(enabled: Boolean) = viewModelScope.launch { repo.setAutoReconnect(enabled) }
}

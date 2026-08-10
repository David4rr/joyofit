package com.watchfitre.ui.debug

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.watchfitre.log.ExportFormat
import com.watchfitre.log.PacketDirection
import com.watchfitre.log.PacketLogEntry
import com.watchfitre.log.PacketLogExporter
import com.watchfitre.log.PacketLogger
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import java.io.File
import javax.inject.Inject

@HiltViewModel
class PacketLogViewModel @Inject constructor(
    private val logger: PacketLogger,
    private val exporter: PacketLogExporter,
) : ViewModel() {

    private val _filterDirection = MutableStateFlow<PacketDirection?>(null)
    val filterDirection: StateFlow<PacketDirection?> = _filterDirection.asStateFlow()

    private val _filterChar = MutableStateFlow<String?>(null)
    val filterChar: StateFlow<String?> = _filterChar.asStateFlow()

    /** Poll snapshot on every emitted entry. Cheaper than buffering the whole flow. */
    private val _entries = MutableStateFlow<List<PacketLogEntry>>(emptyList())
    val entries: StateFlow<List<PacketLogEntry>> = _entries

    init {
        viewModelScope.launch {
            logger.live.collect {
                _entries.value = logger.snapshot()
            }
        }
    }

    fun setDirectionFilter(d: PacketDirection?) { _filterDirection.value = d }
    fun setCharFilter(uuid: String?) { _filterChar.value = uuid?.lowercase() }

    fun filtered(): List<PacketLogEntry> {
        val dir = _filterDirection.value
        val char = _filterChar.value
        return _entries.value.filter { e ->
            (dir == null || e.direction == dir) &&
                (char.isNullOrBlank() || e.characteristicUuid?.lowercase()?.contains(char) == true)
        }
    }

    fun clear() {
        logger.clear()
        _entries.value = emptyList()
    }

    fun export(format: ExportFormat): File = exporter.export(filtered(), format)
}

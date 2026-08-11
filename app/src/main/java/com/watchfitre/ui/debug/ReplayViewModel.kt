package com.watchfitre.ui.debug

import android.content.Context
import android.net.Uri
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.watchfitre.log.PacketCaptureReader
import com.watchfitre.log.PacketDirection
import com.watchfitre.log.PacketLogger
import com.watchfitre.log.PacketLogEntry
import com.watchfitre.log.replay
import com.watchfitre.protocol.PacketParser
import com.watchfitre.protocol.model.Packet
import dagger.hilt.android.lifecycle.HiltViewModel
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject

@HiltViewModel
class ReplayViewModel @Inject constructor(
    @ApplicationContext private val context: Context,
    private val logger: PacketLogger,
) : ViewModel() {

    data class ReplayState(
        val entries: List<PacketLogEntry> = emptyList(),
        val error: String? = null,
    )

    private val _state = MutableStateFlow(ReplayState())
    val state: StateFlow<ReplayState> = _state.asStateFlow()

    private val parser = PacketParser()

    fun load(uri: Uri) {
        viewModelScope.launch {
            try {
                val json = withContext(Dispatchers.IO) {
                    context.contentResolver.openInputStream(uri)?.use {
                        it.bufferedReader().readText()
                    } ?: error("Could not open capture file")
                }
                _state.value = ReplayState(entries = PacketCaptureReader.from(json))
            } catch (e: Exception) {
                _state.value = ReplayState(error = e.message ?: "Failed to load capture")
            }
        }
    }

    /** Re-inject the loaded capture into the live packet log. Returns count injected. */
    fun inject(): Int {
        val entries = _state.value.entries
        if (entries.isNotEmpty()) logger.replay(entries)
        return entries.size
    }

    /**
     * How many RX entries the protocol parser can currently decode. Stays 0 until commands are
     * VERIFIED and implemented (PRD §29). Surfaced so the user sees the RE gap concretely.
     */
    fun decodedCount(): Int = _state.value.entries.count { e ->
        e.direction == PacketDirection.RX && parser.parse(Packet(e.direction, e.op, e.payload)) != null
    }

    fun clearError() {
        _state.value = _state.value.copy(error = null)
    }
}

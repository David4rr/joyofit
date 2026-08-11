package com.watchfitre.ble

import android.bluetooth.BluetoothAdapter
import com.watchfitre.ble.model.ConnectionState
import com.watchfitre.di.AppModule.ApplicationScope
import com.watchfitre.settings.SettingsRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Foreground-only auto-reconnect (PRD §19). Watches [BleConnectionManager.state]; when the
 * link drops and the user has auto-reconnect on with a remembered device, retries the
 * connection with exponential backoff (1s → 2s → … capped at 30s).
 *
 * Intentionally NOT a background service: PRD §19 mandates background sync only after
 * foreground sync is reliable. This keeps the link alive while the app process is alive.
 */
@Singleton
class ReconnectController @Inject constructor(
    private val connection: BleConnectionManager,
    private val adapter: BluetoothAdapter?,
    private val settings: SettingsRepository,
    @ApplicationScope private val scope: CoroutineScope,
) {

    @Volatile private var job: Job? = null

    fun start() {
        if (job?.isActive == true) return
        job = scope.launch {
            var attempt = 0
            connection.state.collect { state ->
                when (state) {
                    is ConnectionState.Disconnected -> {
                        val s = settings.settings.first()
                        val mac = s.lastDeviceMac
                        if (s.autoReconnect && mac != null) {
                            attempt++
                            delay(backoffMs(attempt))
                            // Re-check: a manual connect may have happened during the delay.
                            if (connection.state.value is ConnectionState.Disconnected) {
                                tryReconnect(mac)
                            }
                        } else {
                            attempt = 0
                        }
                    }
                    is ConnectionState.Connecting,
                    is ConnectionState.DiscoveringServices,
                    is ConnectionState.Ready -> attempt = 0
                    is ConnectionState.Scanning,
                    is ConnectionState.Failed -> Unit
                }
            }
        }
    }

    fun stop() {
        job?.cancel()
        job = null
    }

    private suspend fun tryReconnect(mac: String) {
        val ada = adapter ?: return
        val device = runCatching { ada.getRemoteDevice(mac) }.getOrNull() ?: return
        // connectGatt expects the main thread on some OEM stacks.
        withContext(Dispatchers.Main) {
            connection.connect(device)
        }
    }

    private fun backoffMs(attempt: Int): Long {
        val exp = (1L shl (attempt - 1).coerceAtMost(5)) // 1,2,4,8,16,32
        return (1_000L * exp).coerceAtMost(30_000L)
    }
}

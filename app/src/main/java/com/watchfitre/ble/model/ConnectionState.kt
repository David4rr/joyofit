package com.watchfitre.ble.model

/**
 * Coarse connection lifecycle. UI drives off this single flow.
 *
 * SUCCESS / terminal-ish failure carries a human-readable reason.
 */
sealed interface ConnectionState {
    data object Disconnected : ConnectionState
    data object Scanning : ConnectionState
    data class Connecting(val address: String) : ConnectionState
    data object DiscoveringServices : ConnectionState
    data class Ready(val address: String) : ConnectionState
    data class Failed(val reason: String) : ConnectionState

    fun isConnected(): Boolean = this is Ready
    fun isBusy(): Boolean = this is Connecting || this is DiscoveringServices || this is Scanning
}

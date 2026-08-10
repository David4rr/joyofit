package com.watchfitre.ble.model

/** Discovered BLE device snapshot from a scan result. */
data class BleDevice(
    val address: String,
    val name: String?,
    val rssi: Int,
    val timestampMs: Long,
) {
    val displayName: String get() = name?.takeIf { it.isNotBlank() } ?: "Unknown device"
}

package com.watchfitre.device

/**
 * Decoded standard-GATT device info. All fields nullable because the watch may not expose
 * every standard characteristic, and per PRD §29 we never fabricate values.
 *
 * Populated only from OBSERVED reads of:
 *  - 0x2A19 Battery Level
 *  - 0x2A24 Model Number, 0x2A26 Firmware, 0x2A27 Hardware, 0x2A29 Manufacturer, 0x2A25 Serial
 *  - 0x2A00 Device Name
 */
data class DeviceInfo(
    val batteryPct: Int? = null,
    val name: String? = null,
    val model: String? = null,
    val firmware: String? = null,
    val hardware: String? = null,
    val manufacturer: String? = null,
    val serial: String? = null,
) {
    /** Signal-quality label derived from RSSI, for display. */
    fun signalLabel(rssi: Int?): String = when {
        rssi == null -> "—"
        rssi >= -60 -> "Excellent"
        rssi >= -70 -> "Good"
        rssi >= -80 -> "Fair"
        rssi >= -90 -> "Weak"
        else -> "Very weak"
    }

    fun isEmpty(): Boolean = batteryPct == null && name == null && model == null &&
        firmware == null && hardware == null && manufacturer == null && serial == null
}

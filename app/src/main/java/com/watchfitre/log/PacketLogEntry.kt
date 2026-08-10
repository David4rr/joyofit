package com.watchfitre.log

/**
 * One captured BLE packet / event. Stored in-memory only (Phase 2+ may persist).
 *
 * @property epochMs wall-clock millis at capture.
 * @property direction TX = phone→watch, RX = watch→phone.
 * @property op        the GATT operation that produced this entry.
 * @property serviceUuid nullable if not yet resolved.
 * @property characteristicUuid nullable if not yet resolved.
 * @property payload   raw bytes; may be empty for events.
 * @property gattStatus GATT status code (0 = success). -1 if not applicable.
 * @property rssi      only set for scan-result / read-rssi events.
 */
data class PacketLogEntry(
    val epochMs: Long,
    val direction: PacketDirection,
    val op: PacketOp,
    val serviceUuid: String?,
    val characteristicUuid: String?,
    val payload: ByteArray,
    val gattStatus: Int = 0,
    val rssi: Int? = null,
) {
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is PacketLogEntry) return false
        return epochMs == other.epochMs &&
            direction == other.direction &&
            op == other.op &&
            serviceUuid == other.serviceUuid &&
            characteristicUuid == other.characteristicUuid &&
            gattStatus == other.gattStatus &&
            rssi == other.rssi &&
            payload.contentEquals(other.payload)
    }

    override fun hashCode(): Int {
        var r = epochMs.hashCode()
        r = 31 * r + direction.hashCode()
        r = 31 * r + op.hashCode()
        r = 31 * r + (serviceUuid?.hashCode() ?: 0)
        r = 31 * r + (characteristicUuid?.hashCode() ?: 0)
        r = 31 * r + gattStatus
        r = 31 * r + (rssi ?: 0)
        r = 31 * r + payload.contentHashCode()
        return r
    }
}

enum class PacketDirection { TX, RX }

enum class PacketOp {
    SCAN_RESULT,
    CONNECT,
    DISCONNECT,
    SERVICE_DISCOVERY,
    READ,
    WRITE,
    NOTIFY,
    INDICATE,
    RSSI,
}

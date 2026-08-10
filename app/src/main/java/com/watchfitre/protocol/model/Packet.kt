package com.watchfitre.protocol.model

import com.watchfitre.log.PacketDirection
import com.watchfitre.log.PacketOp

/**
 * Protocol-layer view of a frame. Distinct from [com.watchfitre.log.PacketLogEntry] (raw BLE
 * capture) so the protocol layer can stay transport-agnostic per PRD §14.
 *
 * NOTE: structure intentionally empty beyond raw bytes until a frame format is OBSERVED.
 */
data class Packet(
    val direction: PacketDirection,
    val op: PacketOp,
    val raw: ByteArray,
) {
    override fun equals(other: Any?): Boolean =
        this === other || (other is Packet && direction == other.direction && op == other.op && raw.contentEquals(other.raw))
    override fun hashCode(): Int = raw.contentHashCode()
}

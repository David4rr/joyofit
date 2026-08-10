package com.watchfitre.protocol

import com.watchfitre.protocol.model.Packet

/**
 * Decodes raw BLE payloads into protocol frames.
 *
 * STUB. Do not implement until a frame format has been OBSERVED and REPRODUCED
 * against the Watch Fit 4 Pro (PRD §29). Returning the raw bytes unchanged is the
 * correct behaviour for an unknown protocol — never guess a field layout.
 */
class PacketParser {

    /**
     * @return the parsed command, or null if the bytes do not match any known frame.
     *         Callers MUST treat null as "preserve as raw" (PRD §24).
     */
    fun parse(packet: Packet): DecodedPacket? {
        // TODO(Phase 2): once frames are observed, identify magic / length / cmd / checksum.
        return null
    }
}

/**
 * A decoded command. Fields filled in incrementally as the protocol is reverse-engineered.
 */
data class DecodedPacket(
    val commandId: Int? = null,
    val confidence: ConfidenceLevel = ConfidenceLevel.UNKNOWN,
    val note: String = "",
)

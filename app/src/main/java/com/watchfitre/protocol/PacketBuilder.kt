package com.watchfitre.protocol

import com.watchfitre.log.PacketDirection
import com.watchfitre.log.PacketOp
import com.watchfitre.protocol.model.Packet

/**
 * Encodes protocol commands into raw BLE payloads.
 *
 * STUB. No command is generated until its wire format is VERIFIED (PRD §29).
 */
class PacketBuilder {

    fun build(commandId: Int, body: ByteArray = ByteArray(0)): Packet {
        // TODO(Phase 2): encode magic + length + commandId + body + checksum once VERIFIED.
        throw UnsupportedOperationException(
            "PacketBuilder: command 0x${commandId.toString(16)} not yet VERIFIED. " +
                "Do not send frames that have not been experimentally confirmed.",
        )
    }

    /** Pass-through helper for raw user-entered payloads in the GATT explorer. */
    fun raw(payload: ByteArray): Packet =
        Packet(PacketDirection.TX, PacketOp.WRITE, payload)
}

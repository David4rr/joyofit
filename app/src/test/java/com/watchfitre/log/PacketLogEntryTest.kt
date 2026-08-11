package com.watchfitre.log

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Test

class PacketLogEntryTest {

    private fun e(payload: ByteArray, ts: Long = 1L) =
        PacketLogEntry(ts, PacketDirection.RX, PacketOp.NOTIFY, null, null, payload)

    @Test fun equals_sameContentEqual() {
        assertEquals(e(byteArrayOf(1, 2, 3)), e(byteArrayOf(1, 2, 3)))
    }

    @Test fun equals_differentPayloadNotEqual() {
        assertNotEquals(e(byteArrayOf(1, 2, 3)), e(byteArrayOf(1, 2, 4)))
    }

    @Test fun equals_differentTimestampNotEqual() {
        assertNotEquals(e(byteArrayOf(1), 1L), e(byteArrayOf(1), 2L))
    }

    @Test fun hashCode_consistentWithEquals() {
        val a = e(byteArrayOf(1, 2, 3))
        val b = e(byteArrayOf(1, 2, 3))
        assertEquals(a.hashCode(), b.hashCode())
    }

    @Test fun hashCode_notEqualForDifferentPayload() {
        val a = e(byteArrayOf(1, 2, 3))
        val b = e(byteArrayOf(4, 5, 6))
        assertFalse(a.hashCode() == b.hashCode())
    }
}

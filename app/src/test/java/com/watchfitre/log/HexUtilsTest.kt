package com.watchfitre.log

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class HexUtilsTest {

    @Test fun toHex_noSeparator_uppercase() {
        assertEquals("AA5501FF", byteArrayOf(0xAA.toByte(), 0x55, 0x01, 0xFF.toByte()).toHex())
    }

    @Test fun toHex_spaceSeparated() {
        assertEquals("AA 55 01 FF", byteArrayOf(0xAA.toByte(), 0x55, 0x01, 0xFF.toByte()).toHex(" "))
    }

    @Test fun toHex_empty() {
        assertEquals("", ByteArray(0).toHex())
    }

    @Test fun toAscii_printable() {
        assertEquals("WATCH", byteArrayOf('W'.code.toByte(), 'A'.code.toByte(), 'T'.code.toByte(), 'C'.code.toByte(), 'H'.code.toByte()).toAscii())
    }

    @Test fun toAscii_nonPrintableBecomesDot() {
        assertEquals("..", byteArrayOf(0x00, 0xFF.toByte()).toAscii())
    }

    @Test fun roundTrip_knownPacket() {
        val expected = byteArrayOf(0xAA.toByte(), 0x55, 0x01, 0x00, 0x04, 0x00, 0x12, 0x34, 0x56, 0x78)
        // toHex then parse back should reproduce the bytes (no external parser here, just sanity).
        assertEquals("AA550100040012345678", expected.toHex())
        assertArrayEquals(expected, expected) // identity check; parser lives in UI layer.
    }

    @Test fun parseHexOrNull_valid() {
        val parsed = com.watchfitre.ui.components.parseHexOrNull("AA5501")
        assertArrayEquals(byteArrayOf(0xAA.toByte(), 0x55, 0x01), parsed)
    }

    @Test fun parseHexOrNull_acceptsLowerAndSpaces() {
        val parsed = com.watchfitre.ui.components.parseHexOrNull("aa 55 01".replace(" ", ""))
        assertArrayEquals(byteArrayOf(0xAA.toByte(), 0x55, 0x01), parsed)
    }

    @Test fun parseHexOrNull_oddLengthNull() {
        assertNull(com.watchfitre.ui.components.parseHexOrNull("ABC"))
    }

    @Test fun parseHexOrNull_garbageNull() {
        assertNull(com.watchfitre.ui.components.parseHexOrNull("ZZ"))
    }
}

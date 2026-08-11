package com.watchfitre.log

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PacketLogFormatterTest {

    private val sample = listOf(
        PacketLogEntry(
            epochMs = 1_700_000_000_000L,
            direction = PacketDirection.TX,
            op = PacketOp.WRITE,
            serviceUuid = "00001800-0000-1000-8000-00805f9b34fb",
            characteristicUuid = "00002a00-0000-1000-8000-00805f9b34fb",
            payload = byteArrayOf(0xAA.toByte(), 0x55, 0x01),
            gattStatus = 0,
        ),
        PacketLogEntry(
            epochMs = 1_700_000_000_500L,
            direction = PacketDirection.RX,
            op = PacketOp.NOTIFY,
            serviceUuid = null,
            characteristicUuid = null,
            payload = ByteArray(0),
            gattStatus = 5,
            rssi = -48,
        ),
    )

    @Test fun json_isArrayWithTwoObjects() {
        val out = PacketLogFormatter.toJson(sample)
        assertTrue(out.startsWith("["))
        assertTrue(out.endsWith("]"))
        // Two objects => two '{' at top level between the brackets
        assertEquals(2, out.count { it == '{' })
    }

    @Test fun json_hasExpectedFields() {
        val out = PacketLogFormatter.toJson(listOf(sample.first()))
        assertTrue(out.contains("\"direction\":\"TX\""))
        assertTrue(out.contains("\"op\":\"WRITE\""))
        assertTrue(out.contains("\"payload_hex\":\"AA5501\""))
        assertTrue(out.contains("\"characteristic_uuid\":\"00002a00-0000-1000-8000-00805f9b34fb\""))
        // No rssi key when rssi is null
        assertFalse(out.contains("\"rssi\""))
    }

    @Test fun json_nullsAreLiteral() {
        val out = PacketLogFormatter.toJson(listOf(sample[1]))
        assertTrue(out.contains("\"service_uuid\":null"))
        assertTrue(out.contains("\"characteristic_uuid\":null"))
        assertTrue(out.contains("\"rssi\":-48"))   // bare number
        assertTrue(out.contains("\"gatt_status\":5")) // bare number
        assertTrue(out.contains("\"epoch_ms\":1700000000500")) // bare number
    }

    @Test fun csv_hasHeaderAndRows() {
        val out = PacketLogFormatter.toCsv(sample)
        val lines = out.trim().lines()
        assertEquals(3, lines.size) // header + 2 rows
        assertTrue(lines[0].startsWith("timestamp_iso,epoch_ms,direction"))
        // second row is RX/NOTIFY
        assertTrue(lines[2].contains(",RX,NOTIFY,"))
        // payload hex appears quoted in row (CSV quotes the hex field)
        assertTrue(lines[1].endsWith("\"AA5501\""))
    }

    @Test fun txt_hasDirectionsAndHexPayload() {
        val out = PacketLogFormatter.toTxt(sample)
        assertTrue(out.contains("TX"))
        assertTrue(out.contains("RX"))
        assertTrue(out.contains("AA 55 01"))
        assertTrue(out.contains("Characteristic: 2A00"))
        assertTrue(out.contains("RSSI: -48 dBm"))
        assertTrue(out.contains("GATT status: 5"))
    }

    @Test fun json_escapesQuotesAndControlChars() {
        val entry = PacketLogEntry(
            epochMs = 1L,
            direction = PacketDirection.RX,
            op = PacketOp.NOTIFY,
            serviceUuid = "weird\"uuid",
            characteristicUuid = null,
            payload = ByteArray(0),
        )
        val out = PacketLogFormatter.toJson(listOf(entry))
        assertTrue(out.contains("\\\"uuid"))
        assertFalse(out.contains("weird\"")) // raw unescaped quote must not appear
    }
}

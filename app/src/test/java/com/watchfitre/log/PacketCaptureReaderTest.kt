package com.watchfitre.log

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PacketCaptureReaderTest {

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

    @Test fun roundTrip_formatterWriter_readerParser() {
        val json = PacketLogFormatter.toJson(sample)
        val back = PacketCaptureReader.from(json)
        assertEquals(sample.size, back.size)
        for ((a, b) in sample.zip(back)) {
            assertEquals(a.epochMs, b.epochMs)
            assertEquals(a.direction, b.direction)
            assertEquals(a.op, b.op)
            assertEquals(a.serviceUuid, b.serviceUuid)
            assertEquals(a.characteristicUuid, b.characteristicUuid)
            assertArrayEquals(a.payload, b.payload)
            assertEquals(a.gattStatus, b.gattStatus)
            assertEquals(a.rssi, b.rssi)
        }
    }

    @Test fun emptyArrayProducesEmptyList() {
        assertEquals(0, PacketCaptureReader.from("[]").size)
    }

    @Test fun garbageReturnsEmpty() {
        // PRD §24: malformed input never throws.
        assertEquals(0, PacketCaptureReader.from("not json").size)
    }

    @Test fun malformedEntrySkippedOthersKept() {
        // One valid object, one with bad enum value.
        val json = """[
            {"epoch_ms":100,"direction":"TX","op":"WRITE","service_uuid":null,"characteristic_uuid":null,"gatt_status":0,"payload_hex":"AA","payload_ascii":""},
            {"epoch_ms":200,"direction":"BOGUS","op":"WRITE","service_uuid":null,"characteristic_uuid":null,"gatt_status":0,"payload_hex":"","payload_ascii":""}
        ]"""
        val back = PacketCaptureReader.from(json)
        assertEquals(1, back.size)
        assertEquals(100L, back[0].epochMs)
    }

    @Test fun hexToBytes_roundTrip() {
        assertArrayEquals(byteArrayOf(0xAA.toByte(), 0x55, 0x01), "AA5501".hexToBytes())
        // tolerate spaces
        assertArrayEquals(byteArrayOf(0xAA.toByte(), 0x55, 0x01), "AA 55 01".hexToBytes())
        // lowercase
        assertArrayEquals(byteArrayOf(0xAA.toByte(), 0x55, 0x01), "aa5501".hexToBytes())
    }

    @Test fun hexToBytes_oddLengthEmpty() {
        assertEquals(0, "ABC".hexToBytes().size)
    }

    @Test fun replay_injectsEntriesIntoLogger() = runTest {
        val logger = PacketLogger()
        val received = mutableListOf<PacketLogEntry>()
        backgroundScope.launch { logger.live.collect { received += it } }
        runCurrent()
        val entries = listOf(
            PacketLogEntry(1, PacketDirection.RX, PacketOp.NOTIFY, null, null, byteArrayOf(1)),
            PacketLogEntry(2, PacketDirection.TX, PacketOp.WRITE, null, null, byteArrayOf(2)),
        )
        logger.replay(entries)
        runCurrent()
        assertEquals(2, received.size)
    }

    @Test fun replayFromFileFormat_roundTripsThroughJson() {
        // Simulate: export -> read back -> replay count preserved.
        val json = PacketLogFormatter.toJson(sample)
        val reloaded = PacketCaptureReader.from(json)
        assertTrue("reload preserved ${reloaded.size}/${sample.size}", reloaded.size == sample.size)
    }
}

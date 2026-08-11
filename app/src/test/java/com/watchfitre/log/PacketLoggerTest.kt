package com.watchfitre.log

import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PacketLoggerTest {

    private fun entry(ts: Long, dir: PacketDirection = PacketDirection.RX) =
        PacketLogEntry(
            epochMs = ts,
            direction = dir,
            op = PacketOp.NOTIFY,
            serviceUuid = null,
            characteristicUuid = null,
            payload = byteArrayOf(0x01),
        )

    @Test fun snapshot_returnsLoggedEntries() = runTest {
        val logger = PacketLogger()
        logger.log(entry(1))
        logger.log(entry(2))
        assertEquals(2, logger.snapshot().size)
    }

    @Test fun clear_emptiesBuffer() {
        val logger = PacketLogger()
        logger.log(entry(1))
        logger.clear()
        assertEquals(0, logger.snapshot().size)
    }

    @Test fun ringBuffer_capsAndEvictsOldest() {
        val logger = PacketLogger()
        // CAP is private (5000); overflow enough to force eviction. DROP_BATCH is 64.
        repeat(6000) { logger.log(entry(it.toLong())) }
        val snap = logger.snapshot()
        assertTrue("size should be bounded under cap+batch: ${snap.size}", snap.size in 1..5000)
        // newest entries survive
        assertEquals(5999L, snap.last().epochMs)
    }

    @Test fun live_emitsToSubscriber() = runTest {
        val logger = PacketLogger()
        val received = mutableListOf<PacketLogEntry>()
        backgroundScope.launch { logger.live.collect { received += it } }
        runCurrent() // let the collector subscribe before we emit
        logger.log(entry(7))
        runCurrent() // flush the emission to the collector
        assertEquals(1, received.size)
        assertEquals(7L, received.first().epochMs)
    }
}

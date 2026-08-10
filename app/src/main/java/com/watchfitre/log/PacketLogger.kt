package com.watchfitre.log

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import java.util.ArrayDeque
import javax.inject.Inject
import javax.inject.Singleton

/**
 * In-memory BLE packet log. Lightweight — no DB in v0.1 (PRD §27).
 *
 * - [live]: hot stream for the live viewer.
 * - [snapshot]: ring-buffered history for the log screen / export.
 *
 * Synchronized on the deque; cap is [CAP]. Older entries drop on overflow.
 */
@Singleton
class PacketLogger @Inject constructor() {

    private val buffer = ArrayDeque<PacketLogEntry>(CAP)
    private val lock = Any()

    private val _live = MutableSharedFlow<PacketLogEntry>(
        replay = 0,
        extraBufferCapacity = 256,
    )
    val live: SharedFlow<PacketLogEntry> = _live.asSharedFlow()

    fun log(entry: PacketLogEntry) {
        synchronized(lock) {
            if (buffer.size >= CAP) {
                // Drop oldest in batches to amortize the cost.
                repeat(DROP_BATCH) { buffer.pollFirst() }
            }
            buffer.addLast(entry)
        }
        _live.tryEmit(entry)
    }

    fun snapshot(): List<PacketLogEntry> = synchronized(lock) { buffer.toList() }

    fun clear() = synchronized(lock) { buffer.clear() }

    companion object {
        // ~5k entries keeps a full pairing/sync capture without ballooning memory.
        private const val CAP = 5_000
        private const val DROP_BATCH = 64
    }
}

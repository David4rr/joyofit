package com.watchfitre.sync

import com.watchfitre.settings.SettingsRepository
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Orchestrates incremental sync: Watch → BLE → ProtocolDecoder → Dedup → Room (PRD §18).
 *
 * STUB until at least one health metric is REPRODUCED (PRD §16 P0, MVP v0.3).
 * Must remain incremental and never pull the whole watch DB.
 */
@Singleton
class SyncManager @Inject constructor(
    private val settings: SettingsRepository,
) {
    suspend fun sync() {
        // TODO(Phase 3): request records after settings.lastSyncEpochMs, dedupe, store.
        require(false) { "SyncManager.sync() not implemented — see PRD §27 MVP v0.3." }
    }
}

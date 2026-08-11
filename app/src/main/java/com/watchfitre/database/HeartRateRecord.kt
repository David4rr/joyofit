package com.watchfitre.database

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * One heart-rate sample. PRD §17.
 *
 * `watchId + timestamp` is unique so re-syncs dedupe (PRD §18). `source` records which
 * characteristic/session produced it once the protocol is decoded.
 */
@Entity(
    tableName = "heart_rate_record",
    indices = [Index(value = ["watchId", "timestamp"], unique = true)],
)
data class HeartRateRecord(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val timestamp: Long,
    val heartRate: Int,
    val source: String?,
    val watchId: String,
    val createdAt: Long,
)

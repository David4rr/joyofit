package com.watchfitre.database

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** Daily step summary. PRD §17. Unique per watch+date (epoch days). */
@Entity(
    tableName = "step_record",
    indices = [Index(value = ["watchId", "date"], unique = true)],
)
data class StepRecord(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    /** Epoch day (UTC midnight) — stable day key for dedup. */
    val date: Long,
    val steps: Int,
    val distanceMeters: Int,
    val calories: Int,
    val watchId: String,
)

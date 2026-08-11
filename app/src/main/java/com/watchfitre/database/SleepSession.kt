package com.watchfitre.database

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** One sleep session with stage durations (minutes). PRD §17. Unique per watch+start time. */
@Entity(
    tableName = "sleep_session",
    indices = [Index(value = ["watchId", "startTime"], unique = true)],
)
data class SleepSession(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val startTime: Long,
    val endTime: Long,
    val durationMinutes: Int,
    val deepSleepMinutes: Int,
    val lightSleepMinutes: Int,
    val remSleepMinutes: Int,
    val awakeMinutes: Int,
    val watchId: String,
)

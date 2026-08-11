package com.watchfitre.database

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/** One workout. PRD §17. Unique per watch+start time. Field set extensible as protocol is decoded. */
@Entity(
    tableName = "workout",
    indices = [Index(value = ["watchId", "startTime"], unique = true)],
)
data class Workout(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val type: String,
    val startTime: Long,
    val endTime: Long,
    val durationSeconds: Int,
    val distanceMeters: Int,
    val calories: Int,
    val avgHeartRate: Int?,
    val maxHeartRate: Int?,
    val watchId: String,
)

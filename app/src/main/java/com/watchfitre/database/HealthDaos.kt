package com.watchfitre.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface HeartRateDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(records: List<HeartRateRecord>): List<Long>

    @Query("SELECT * FROM heart_rate_record WHERE watchId = :watchId AND timestamp >= :since ORDER BY timestamp ASC")
    fun observeSince(watchId: String, since: Long): Flow<List<HeartRateRecord>>

    @Query("SELECT * FROM heart_rate_record WHERE watchId = :watchId ORDER BY timestamp DESC LIMIT :limit")
    fun recent(watchId: String, limit: Int = 100): Flow<List<HeartRateRecord>>

    @Query("SELECT MAX(timestamp) FROM heart_rate_record WHERE watchId = :watchId")
    suspend fun newestTimestamp(watchId: String): Long?
}

@Dao
interface StepDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(records: List<StepRecord>): List<Long>

    @Query("SELECT * FROM step_record WHERE watchId = :watchId ORDER BY date DESC LIMIT :limit")
    fun recent(watchId: String, limit: Int = 30): Flow<List<StepRecord>>
}

@Dao
interface SleepDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(records: List<SleepSession>): List<Long>

    @Query("SELECT * FROM sleep_session WHERE watchId = :watchId ORDER BY startTime DESC LIMIT :limit")
    fun recent(watchId: String, limit: Int = 30): Flow<List<SleepSession>>
}

@Dao
interface WorkoutDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertAll(records: List<Workout>): List<Long>

    @Query("SELECT * FROM workout WHERE watchId = :watchId ORDER BY startTime DESC LIMIT :limit")
    fun recent(watchId: String, limit: Int = 50): Flow<List<Workout>>
}

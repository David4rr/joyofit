package com.watchfitre.database

import androidx.room.Database
import androidx.room.RoomDatabase

/**
 * Local store. v0.3+ (PRD §17, §27). Privacy: lives on-device only; backup rules exclude it
 * (res/xml/backup_rules.xml). Schema versioning: bump [version] + add a migration when the
 * schema changes after a release.
 */
@Database(
    entities = [
        HeartRateRecord::class,
        StepRecord::class,
        SleepSession::class,
        Workout::class,
    ],
    version = 1,
    exportSchema = true,
)
abstract class WatchFitDatabase : RoomDatabase() {
    abstract fun heartRateDao(): HeartRateDao
    abstract fun stepDao(): StepDao
    abstract fun sleepDao(): SleepDao
    abstract fun workoutDao(): WorkoutDao

    companion object {
        const val DB_NAME = "watchfit.db"
    }
}

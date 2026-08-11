package com.watchfitre.di

import android.content.Context
import androidx.room.Room
import com.watchfitre.database.HeartRateDao
import com.watchfitre.database.SleepDao
import com.watchfitre.database.StepDao
import com.watchfitre.database.WatchFitDatabase
import com.watchfitre.database.WorkoutDao
import dagger.Module
import dagger.Provides
import dagger.hilt.InstallIn
import dagger.hilt.android.qualifiers.ApplicationContext
import dagger.hilt.components.SingletonComponent
import javax.inject.Singleton

@Module
@InstallIn(SingletonComponent::class)
object DatabaseModule {

    @Provides
    @Singleton
    fun provideDatabase(@ApplicationContext context: Context): WatchFitDatabase =
        Room.databaseBuilder(context, WatchFitDatabase::class.java, WatchFitDatabase.DB_NAME)
            // Schema migrations added here as the protocol is decoded (PRD §17).
            .fallbackToDestructiveMigration(false)
            .build()

    @Provides fun provideHeartRateDao(db: WatchFitDatabase): HeartRateDao = db.heartRateDao()
    @Provides fun provideStepDao(db: WatchFitDatabase): StepDao = db.stepDao()
    @Provides fun provideSleepDao(db: WatchFitDatabase): SleepDao = db.sleepDao()
    @Provides fun provideWorkoutDao(db: WatchFitDatabase): WorkoutDao = db.workoutDao()
}

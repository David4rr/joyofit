/**
 * Revision of the numbers `analyzeWorkout` produces (distance, moving time, elevation, pace, ...). The cloud upload
 * (`src/cloud/workoutSync.ts`) stores it with each workout and sends a workout again when its stored revision is lower;
 * bump it whenever a figure changes for the same workout.
 *
 * 2: distance is the watch's total, moving time follows Strava, elevation is smoothed with a hysteresis.
 */
export const ANALYSIS_ENGINE_REV = 2;

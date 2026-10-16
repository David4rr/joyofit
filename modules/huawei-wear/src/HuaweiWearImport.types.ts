/** What `importHuaweiExport` found and wrote (`HuaweiImportSummary.toJs()` in `HuaweiExportImporter.kt`). */
export interface HuaweiImportSummary {
  /** Data files read to the end. */
  filesRead: number;
  /** Data files the ZIP could not deliver (damaged member). */
  filesFailed: number;
  /** ZIP members that are not Health data files (plans, descriptors, spreadsheets). */
  filesIgnored: number;
  /** Records that were not usable JSON and could not be repaired, plus oversize ones. */
  badRecords: number;
  /** Readings of a known kind whose value was missing or implausible. */
  rejectedSamples: number;
  /** Readings of kinds JoyoFit has no place for (weight, exercise intensity ...). */
  unmappedSamples: number;
  heartRateReadings: number;
  restingHeartRateReadings: number;
  spo2Readings: number;
  stressReadings: number;
  sleepSegmentsFound: number;
  /** One-minute rows added or filled in with heart rate, SpO2, resting heart rate, steps or distance. */
  minutesWritten: number;
  /** Sleep segments added; the rest overlapped nights the watch already synced. */
  sleepSegmentsAdded: number;
  stressAdded: number;
  workoutsFound: number;
  /** Workouts added; the rest were already on the phone. */
  workoutsAdded: number;
  workoutPointsAdded: number;
  /** Unix seconds of the oldest and newest thing read, null when nothing was read. */
  oldestSec: number | null;
  newestSec: number | null;
  /** True when `cancelHuaweiImport` stopped the run; what was written so far is kept. */
  cancelled: boolean;
}

/** Sent while `importHuaweiExport` runs, at most four times a second, and once more with `phase: 'done'`. */
export interface HuaweiImportProgressEvent {
  phase: 'reading' | 'done';
  /** The file being read, without its folder. */
  fileName: string | null;
  /** 1-based index of that file among the data files. */
  fileIndex: number;
  fileCount: number;
  /** 0 to 1 over the uncompressed size of all data files. */
  fraction: number;
  /** The counts so far; the same shape as the final result. */
  summary: HuaweiImportSummary;
}

/** `error.code` of a rejected `importHuaweiExport`, besides `ERR_BUSY` and `ERR_STORAGE`. */
export type HuaweiImportErrorCode = 'ERR_IMPORT_PASSWORD' | 'ERR_IMPORT_FORMAT';

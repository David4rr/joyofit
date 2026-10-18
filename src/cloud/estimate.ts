import type { UploadedStats } from '@/db/cloud';

/** Stored bytes per point of a workout that has none uploaded to learn from: an hour with GPS, heart rate and cadence is about 32 KB. */
export const DEFAULT_BYTES_PER_POINT = 9;
/** The analysis a document carries, about 8 KB per workout whatever its length. */
export const ANALYSIS_BYTES = 8 * 1024;
/** Below this many uploaded points (ten minutes at 1 Hz) the average is too noisy to replace the default. */
const MIN_POINTS_TO_LEARN = 600;

/**
 * Bytes one point costs, from what is already in the cloud: its documents minus their analyses, over their points.
 * The default until enough has been uploaded.
 */
export function bytesPerPoint(uploaded: UploadedStats): number {
  if (uploaded.points < MIN_POINTS_TO_LEARN) return DEFAULT_BYTES_PER_POINT;
  const perPoint = (uploaded.bytes - uploaded.workouts * ANALYSIS_BYTES) / uploaded.points;
  return perPoint > 0 ? perPoint : DEFAULT_BYTES_PER_POINT;
}

/** Gzip bytes `workouts` workouts with `points` points in all will take in the cloud. */
export function estimateBytes(workouts: number, points: number, uploaded: UploadedStats): number {
  return Math.round(points * bytesPerPoint(uploaded) + workouts * ANALYSIS_BYTES);
}

/** `850 KB`, `4.2 MB`; a figure for a person, not for arithmetic. */
export function formatSize(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  const mb = bytes / 1_000_000;
  return `${mb < 100 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** The one line the workout detail shows about the cloud copy of a workout. */
export function cloudLineText(input: {
  /** Gzip bytes of the cloud copy; null when the workout was never uploaded. */
  cloudBytes: number | null;
  /** The workout changed (or the analysis engine moved on) since the copy was made. */
  stale: boolean;
  /** Estimated bytes of the document a new upload would send. */
  estimateBytes: number;
  /** The account is not Pro, so nothing is going to be uploaded. */
  locked: boolean;
}): string {
  const { cloudBytes, stale, estimateBytes: estimate, locked } = input;
  if (cloudBytes === null) {
    return locked ? 'Cloud: stays on this phone (JoyoRogo Pro syncs it)' : `Cloud: not uploaded yet (about ${formatSize(estimate)})`;
  }
  const inCloud = `Cloud: in cloud (${formatSize(cloudBytes)})`;
  return stale && !locked ? `${inCloud}, update waiting (about ${formatSize(estimate)})` : inCloud;
}

import type { SQLiteDatabase } from 'expo-sqlite';
import { useCallback, useState } from 'react';

import { errorMessage } from '@/format';

import { shareWorkoutFile } from './shareWorkoutFile';
import { canExportFit, canExportGpx, type ExportFormat, type ExportPoint, type ExportWorkout } from './workoutExport';

export interface WorkoutExport {
  /** Which files this workout can be shared as. */
  available: Record<ExportFormat, boolean>;
  /** The format being built, if any. */
  busy: ExportFormat | null;
  error: string | null;
  run: (format: ExportFormat) => void;
}

/** One export state for the screen, shared by the menu entries and the export section. */
export function useWorkoutExport(db: SQLiteDatabase, workout: (ExportWorkout & { id: number }) | null, points: readonly ExportPoint[]): WorkoutExport {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = workout?.id;

  const run = useCallback(
    (format: ExportFormat) => {
      if (id === undefined || busy !== null) return;
      setError(null);
      setBusy(format);
      shareWorkoutFile(db, id, format)
        .catch((e) => setError(errorMessage(e)))
        .finally(() => setBusy(null));
    },
    [db, id, busy],
  );

  return {
    available: { fit: workout !== null && canExportFit(workout), gpx: workout !== null && canExportGpx(workout, points) },
    busy,
    error,
    run,
  };
}

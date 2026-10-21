import { File, Paths } from 'expo-file-system';
import type { SQLiteDatabase } from 'expo-sqlite';
import Share from 'react-native-share';

import { getWorkout, listWorkoutPoints } from '@/db/queries';
import { t } from '@/i18n';
import { isShareCancel } from '@/features/stickers/share/shareImage';
import { buildWorkoutFit } from '@/features/strava/workoutFit';

import { buildGpx, shareExport, type ExportFormat, type ExportIo } from './workoutExport';

/** Cache directory and the system share sheet. Closing the sheet is not an error. */
export const deviceExportIo: ExportIo = {
  writeCacheFile(name, content) {
    const file = new File(Paths.cache, name);
    file.create({ overwrite: true });
    file.write(content);
    return file.uri;
  },
  async share(uri, mime, name) {
    try {
      await Share.open({ url: uri, type: mime, filename: name, title: name, failOnCancel: false });
    } catch (error) {
      if (!isShareCancel(error)) throw error;
    }
  },
};

/**
 * Builds the workout's file and opens the share sheet. The FIT is the one the Strava upload sends (`buildWorkoutFit`); both
 * work offline. Returns the file name.
 */
export async function shareWorkoutFile(db: SQLiteDatabase, workoutId: number, format: ExportFormat, io: ExportIo = deviceExportIo): Promise<string> {
  const found = await getWorkout(db, workoutId);
  if (!found) throw new Error(t('common:errors.workoutGone'));
  const { workout, summaryJson } = found;
  if (format === 'gpx') return shareExport(io, workout, 'gpx', buildGpx(workout, await listWorkoutPoints(db, workoutId)));
  const { fit } = await buildWorkoutFit(db, workout, summaryJson);
  return shareExport(io, workout, 'fit', fit.bytes);
}

import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { Notice } from '@/components/States';
import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';

import { copy } from './copy';
import type { SavedRoute } from './routeModel';
import { saveRoute } from './routeStore';
import { workoutRouteDraft } from './workoutRoute';

interface SaveWorkoutRouteButtonProps {
  workout: Pick<WorkoutRow, 'sportName' | 'start'>;
  /** The workout's stored points, already loaded by the screen. */
  points: readonly WorkoutPointRow[];
}

/** "Simpan sebagai rute" for the Route section of a workout: saves its GPS track as a route. Renders nothing when the workout has no usable track. */
export function SaveWorkoutRouteButton({ workout, points }: SaveWorkoutRouteButtonProps) {
  const router = useRouter();
  const draft = useMemo(
    () => workoutRouteDraft(copy.workoutPicker.defaultName(workout.sportName, workout.start), points),
    [workout.sportName, workout.start, points],
  );
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedRoute | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (draft === null) return null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      setSaved(await saveRoute(draft));
    } catch (e) {
      setError(copy.workoutPicker.saveFailed(errorMessage(e)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.box}>
      <Button label={saving ? copy.workout.saving : copy.workout.save} icon="trail-sign" loading={saving} disabled={saved !== null} onPress={() => void save()} />
      {saved !== null ? (
        <Notice
          icon="checkmark-circle"
          action={{ label: copy.workout.open, onPress: () => router.push({ pathname: '/routes/[id]', params: { id: saved.id } }) }}>
          {copy.workout.saved(saved.name)}
        </Notice>
      ) : null}
      {error !== null ? <Notice tone="danger">{error}</Notice> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: spacing.sm },
});

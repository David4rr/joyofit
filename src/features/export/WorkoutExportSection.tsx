import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';

import type { WorkoutExport } from './useWorkoutExport';

/** "Share .fit file" and, for a workout with a route, "Share GPX file". Free and offline; nothing shows when no file can be built. */
export function WorkoutExportSection({ exporter }: { exporter: WorkoutExport }) {
  const { t } = useTranslation('workouts');
  if (!exporter.available.fit && !exporter.available.gpx) return null;
  return (
    <Section title={t('export.title')} icon="download-outline" tint="workouts">
      <AppText variant="caption" muted>
        {t('export.hint')}
      </AppText>
      {exporter.available.fit ? (
        <Button
          label={t('export.fit')}
          variant="secondary"
          icon="document-outline"
          onPress={() => exporter.run('fit')}
          loading={exporter.busy === 'fit'}
          disabled={exporter.busy !== null}
        />
      ) : null}
      {exporter.available.gpx ? (
        <Button
          label={t('export.gpx')}
          variant="secondary"
          icon="trail-sign-outline"
          onPress={() => exporter.run('gpx')}
          loading={exporter.busy === 'gpx'}
          disabled={exporter.busy !== null}
        />
      ) : null}
      {exporter.error ? <Notice tone="danger">{exporter.error}</Notice> : null}
    </Section>
  );
}

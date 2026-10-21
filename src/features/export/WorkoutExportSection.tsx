import { Platform } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';

import type { WorkoutExport } from './useWorkoutExport';
import { saveFlow } from './workoutExport';

/**
 * Save the workout as a .fit file (and, for a workout with a route, a GPX file), then upload it by hand on strava.com: the Strava and
 * Garmin Connect apps take no file from the share sheet. Sharing stays as the quiet option for Drive, chats and a laptop. Free and
 * offline; nothing shows when no file can be built.
 */
export function WorkoutExportSection({ exporter }: { exporter: WorkoutExport }) {
  const { t } = useTranslation('workouts');
  if (exporter.entries.length === 0) return null;
  const files = saveFlow(Platform.OS) === 'files';
  const { busy, saved } = exporter;
  const saves = exporter.entries.filter((entry) => entry.action === 'save');
  const shares = exporter.entries.filter((entry) => entry.action === 'share');
  return (
    <Section title={t('export.title')} icon="download-outline" tint="workouts">
      <AppText variant="caption" muted>
        {t('export.hint')}
      </AppText>
      {files ? null : (
        <AppText variant="caption" muted>
          {t('export.folderHint')}
        </AppText>
      )}
      {saves.map(({ format, action, label }) => (
        <Button
          key={format}
          label={label}
          variant={format === 'fit' ? 'primary' : 'secondary'}
          icon={files ? 'folder-outline' : 'download-outline'}
          onPress={() => exporter.run(format, action)}
          loading={busy?.format === format && busy.action === action}
          disabled={busy !== null}
        />
      ))}
      {exporter.available.fit ? (
        <>
          <Button label={t('export.strava')} variant="secondary" icon="open-outline" onPress={exporter.openStrava} />
          <AppText variant="caption" muted>
            {t(files ? 'export.stravaHintFiles' : 'export.stravaHint')}
          </AppText>
        </>
      ) : null}
      {shares.length > 0 ? (
        <ButtonRow>
          {shares.map(({ format, action, label }) => (
            <Button
              key={format}
              label={label}
              variant="ghost"
              icon="share-outline"
              lines={2}
              onPress={() => exporter.run(format, action)}
              loading={busy?.format === format && busy.action === action}
              disabled={busy !== null}
            />
          ))}
        </ButtonRow>
      ) : null}
      {saved ? (
        <Notice icon="checkmark-circle" action={{ label: t('export.otherFolder'), onPress: () => exporter.run(saved.format, 'save', true) }}>
          {t('export.saved', { name: saved.name, folder: saved.folder })}
        </Notice>
      ) : null}
      {exporter.error ? <Notice tone="danger">{exporter.error}</Notice> : null}
    </Section>
  );
}

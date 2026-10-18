import { Fragment } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SPORT_ROWS } from '@/features/workouts/manual';
import { sportLabel } from '@/features/workouts/sportLabel';
import { useRecorder } from '@/state/RecorderProvider';
import { useSensors } from '@/state/SensorsProvider';
import { spacing } from '@/theme';

import { GpsLine } from './GpsLine';
import { sensorErrorKind } from './format';
import { SensorRow } from './SensorRow';

/** Phase `ready`: the native session runs, GPS and sensors are connecting. "Mulai" starts the clock, "Batal" leaves without a recording. */
export function ReadyView() {
  const { t } = useTranslation('workouts');
  const { snapshot, start, cancel } = useRecorder();
  const { saved, hub } = useSensors();
  const sensors = snapshot.sensorIds.flatMap((id) => saved.find((s) => s.id === id) ?? []);
  const sensorError = snapshot.sensorError === null ? null : sensorErrorKind(snapshot.sensorError);

  return (
    <>
      {snapshot.sport ? (
        <AppText variant="heading" accessibilityRole="header">
          {sportLabel(SPORT_ROWS[snapshot.sport].name)}
        </AppText>
      ) : null}

      {snapshot.gps ? (
        <Section title={t('record.ready.gps')} icon="navigate" tint="link">
          <GpsLine fix={snapshot.fix} />
          <AppText variant="caption" muted>
            {t('record.ready.hint')}
          </AppText>
        </Section>
      ) : (
        <AppText variant="caption" muted>
          {t('record.ready.hintNoGps')}
        </AppText>
      )}

      {sensors.length > 0 ? (
        <Section title={t('record.setup.sensors')} icon="bluetooth" tint="link">
          {sensors.map((sensor, index) => (
            <Fragment key={sensor.id}>
              {index > 0 ? <Divider /> : null}
              <SensorRow sensor={sensor} link={hub.links[sensor.id]} beforeStart={false} />
            </Fragment>
          ))}
        </Section>
      ) : null}

      {sensorError !== null ? (
        <Notice
          tone={sensorError === 'other' ? 'info' : 'danger'}
          icon="bluetooth"
          action={sensorError === 'permission' ? { label: t('record.permission.openSettings'), onPress: () => void Linking.openSettings() } : undefined}>
          {t(`record.sensorError.${sensorError}`)}
        </Notice>
      ) : null}
      {snapshot.noService ? (
        <Notice icon="battery-half" action={{ label: t('record.permission.openSettings'), onPress: () => void Linking.openSettings() }}>
          {t('record.ready.noService')}
        </Notice>
      ) : null}

      <Button label={t('record.ready.start')} variant="primary" icon="play" style={styles.start} onPress={start} />
      <Button label={t('record.ready.cancel')} onPress={() => void cancel()} />
    </>
  );
}

const styles = StyleSheet.create({
  start: { minHeight: 64, marginTop: spacing.xs },
});

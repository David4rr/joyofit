import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { StatusDot } from '@/components/StatusDot';
import type { LinkInfo } from '@/features/sensors/hub';
import type { SensorKind } from '@/features/sensors/gatt';
import { kindChannels, sensorLabel, type SavedSensor } from '@/features/sensors/store';
import { fmtInt } from '@/i18n';
import { spacing, useColors } from '@/theme';

/** "Heart rate, cadence": the roles a sensor plays, in the language of the app. */
export function useRoleText(): (kinds: readonly SensorKind[]) => string {
  const { t } = useTranslation('workouts');
  return (kinds) => kindChannels(kinds).map((channel) => t(`record.sensor.role.${channel}`)).join(', ');
}

interface SensorRowProps {
  sensor: SavedSensor;
  /** What the radio knows of this sensor; none until the first connect. */
  link: LinkInfo | undefined;
  /** Before `prepare` a sensor that is not connected yet is not a problem: it connects when the workout starts. */
  beforeStart: boolean;
}

/** One paired sensor: name, roles, link state in words and in a dot, and its latest readings while it is connected. */
export function SensorRow({ sensor, link, beforeStart }: SensorRowProps) {
  const { t } = useTranslation(['workouts', 'common']);
  const colors = useColors();
  const roleText = useRoleText();
  const state = link?.state ?? 'disconnected';
  const stateText =
    state === 'connected'
      ? t('record.sensor.connected')
      : state === 'connecting'
        ? t('record.sensor.connecting')
        : beforeStart
          ? t('record.sensor.willConnect')
          : t('record.sensor.disconnected');
  const dot = state === 'connected' ? colors.link : state === 'connecting' ? colors.warning : colors.mutedForeground;
  const name = sensorLabel(sensor);

  const readings: string[] = [];
  const preview = state === 'connected' ? link?.preview : undefined;
  if (preview?.hr !== undefined) readings.push(t('common:units.bpm', { value: fmtInt(preview.hr) }));
  if (preview?.watts !== undefined) readings.push(t('common:units.w', { value: fmtInt(preview.watts) }));
  if (preview?.cadenceRpm !== undefined) readings.push(`${fmtInt(preview.cadenceRpm)} ${t('analysis.unit.rpm')}`);
  if (preview?.podCadenceSpm !== undefined) readings.push(t('common:units.spm', { value: fmtInt(preview.podCadenceSpm) }));

  return (
    <View accessible accessibilityLabel={t('record.sensor.a11y', { name, state: stateText })} style={styles.row}>
      <StatusDot color={dot} live={state !== 'disconnected'} />
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {name}
        </AppText>
        <AppText variant="caption" muted numberOfLines={2}>
          {[roleText(sensor.kinds), stateText].filter((part) => part !== '').join(' · ')}
        </AppText>
      </View>
      {readings.length > 0 ? (
        <AppText variant="bodyStrong" style={styles.readings}>
          {readings.join(' · ')}
        </AppText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 48 },
  text: { flex: 1, gap: 1 },
  readings: { fontVariant: ['tabular-nums'] },
});

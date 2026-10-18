import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { NavRow } from '@/components/NavRow';
import { Divider, Section } from '@/components/Screen';
import { useSensors } from '@/state/SensorsProvider';
import { spacing } from '@/theme';

import { sensorLabel, type SavedSensor } from '../store';
import { batteryLabel, kindsLabel, readingLine, sensorIcon } from './format';
import { LinkStatusLine } from './parts';

/**
 * The Watch tab's "Sensor" card: the paired sensors in one line each (what it is, battery, link and live reading) and the way into the
 * manager. With none paired it explains what sensors are for and offers to add one. Independent of any watch.
 */
export function SensorsSection() {
  const { t } = useTranslation('watch');
  const router = useRouter();
  const { saved, loaded } = useSensors();
  if (!loaded) return null;
  const open = () => router.push('/watch/sensors');

  return (
    <Section
      title={t('sensors.title')}
      icon="pulse"
      trailing={
        saved.length > 0 ? (
          <AppText variant="caption" muted>
            {saved.length}
          </AppText>
        ) : null
      }>
      {saved.length === 0 ? (
        <>
          <AppText variant="caption" muted>
            {t('sensors.hub.empty')}
          </AppText>
          <Button label={t('sensors.hub.add')} variant="primary" icon="add" onPress={open} />
        </>
      ) : (
        <>
          {saved.map((sensor) => (
            <SensorRow key={sensor.id} sensor={sensor} />
          ))}
          <Divider />
          <NavRow icon="bluetooth" title={t('sensors.hub.manage')} subtitle={t('sensors.hub.manageSub')} style={styles.navRow} onPress={open} />
        </>
      )}
    </Section>
  );
}

function SensorRow({ sensor }: { sensor: SavedSensor }) {
  const link = useSensors().hub.links[sensor.id];
  const state = link?.state ?? 'disconnected';
  const battery = batteryLabel(link?.battery ?? sensor.battery);
  const details = [kindsLabel(sensor.kinds), battery].filter((part): part is string => !!part).join(' · ');
  return (
    <View style={styles.row}>
      <IconChip icon={sensorIcon(sensor.kinds)} tint={state === 'connected' ? 'link' : 'neutral'} />
      <View style={styles.text}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {sensorLabel(sensor)}
        </AppText>
        {details ? (
          <AppText variant="caption" muted numberOfLines={1}>
            {details}
          </AppText>
        ) : null}
        <LinkStatusLine state={state} reading={state === 'connected' && link ? readingLine(link.preview) : null} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  text: { flex: 1, gap: 1 },
  navRow: { paddingHorizontal: 0 },
});

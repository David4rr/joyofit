import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { fmtClock, fmtInt } from '@/i18n';
import { useColors } from '@/theme';

const BAR_AREA_HEIGHT = 96;
const LABEL_EVERY_HOURS = 6;

/** 24 bars, one per local hour, scaled to the busiest hour. Plain Views, no chart library. */
export function HourlyBars({ steps }: { steps: readonly number[] }) {
  const colors = useColors();
  const { t } = useTranslation('today');
  const peak = Math.max(...steps);
  const peakHour = steps.indexOf(peak);
  const hour = fmtClock(new Date(2000, 0, 1, peakHour));
  const summary =
    peak > 0
      ? t('hourly.a11yPeak', { hour, steps: fmtInt(peak), count: peak })
      : t('hourly.a11yEmpty');

  return (
    <View accessible accessibilityLabel={summary} style={styles.wrap}>
      <View style={styles.bars}>
        {steps.map((value, hour) => (
          <View key={hour} style={styles.slot}>
            <View
              style={[
                styles.bar,
                value > 0
                  ? { height: Math.max(3, (value / peak) * BAR_AREA_HEIGHT), backgroundColor: colors.steps }
                  : { height: 3, backgroundColor: colors.muted },
              ]}
            />
          </View>
        ))}
      </View>
      <View style={styles.axis}>
        {steps.map((_, hour) => (
          <View key={hour} style={styles.slot}>
            {hour % LABEL_EVERY_HOURS === 0 || hour === 23 ? (
              <AppText variant="caption" muted style={styles.tick} numberOfLines={1}>
                {hour}
              </AppText>
            ) : null}
          </View>
        ))}
      </View>
      <AppText variant="caption" muted>
        {peak > 0 ? t('hourly.peak', { hour, steps: fmtInt(peak), count: peak }) : t('hourly.empty')}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  bars: { flexDirection: 'row', height: BAR_AREA_HEIGHT, alignItems: 'flex-end', gap: 3 },
  bar: { borderTopLeftRadius: 3, borderTopRightRadius: 3, borderBottomLeftRadius: 1, borderBottomRightRadius: 1 },
  axis: { flexDirection: 'row', gap: 3 },
  slot: { flex: 1, justifyContent: 'flex-end' },
  tick: { width: 24, marginLeft: -6, textAlign: 'center', fontSize: 11, lineHeight: 15 },
});

import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { CountUpText, FadeIn } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { Ring } from '@/components/Ring';
import { Card } from '@/components/Screen';
import type { Readiness } from '@/features/today/readiness';
import { STRAIN_MAX, type DayStrain } from '@/features/today/strain';
import { headlineLabel } from '@/features/today/readiness';
import { fmtDecimal, fmtPercent } from '@/i18n';
import { spacing, useColors } from '@/theme';

const SIZE = 84;
const STROKE = 7;

/**
 * Today at a glance: recovery (or the readiness word until HRV has a baseline), strain, and sleep against need, side by
 * side. The whole card opens the Readiness screen, where each number is explained; Today itself stays short.
 */
export function ScoresCard({ readiness, today, onPress }: { readiness: Readiness; today: DayStrain | null; onPress: () => void }) {
  const colors = useColors();
  const { t } = useTranslation('today');
  const sleep = readiness.signals.find((s) => s.key === 'sleep') ?? null;
  const recovery = readiness.recovery;
  // Without recovery, the ring fills with the share of signals that look good (neutral counts half); the word is the read.
  const fill = readiness.signals.length
    ? readiness.signals.reduce((a, s) => a + (s.tone === 'good' ? 1 : s.tone === 'neutral' ? 0.5 : 0), 0) / readiness.signals.length
    : 0;
  const readinessColor =
    readiness.headline === 'Primed' || readiness.headline === 'Balanced'
      ? colors.link
      : readiness.headline
        ? colors.heart
        : colors.mutedForeground;
  const recoveryColor = recovery
    ? recovery.band === 'green'
      ? colors.link
      : recovery.band === 'yellow'
        ? colors.workouts
        : colors.heart
    : readinessColor;

  return (
    <FadeIn>
      <Card>
        <PressableScale
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={t('scores.a11y')}
          style={styles.row}>
          <Gauge
            label={recovery ? t('scores.recovery') : t('scores.readiness')}
            value={recovery ? recovery.percent : fill}
            max={recovery ? 100 : 1}
            color={recoveryColor}
            track={colors.linkSoft}
            center={recovery ? fmtPercent(recovery.percent) : readiness.headline ? headlineLabel(readiness.headline) : '--'}
            count={recovery ? { value: recovery.percent, decimals: 0, suffix: '%' } : null}
            small={!recovery}
          />
          <Gauge
            label={t('scores.strain')}
            value={today?.strain ?? 0}
            max={STRAIN_MAX}
            color={colors.workouts}
            track={colors.workoutsSoft}
            center={today ? fmtDecimal(today.strain, 1) : '--'}
            count={today ? { value: Number(today.strain.toFixed(1)), decimals: 1, suffix: '' } : null}
          />
          <Gauge
            label={t('scores.sleep')}
            value={sleep?.amount ?? 0}
            max={1}
            color={colors.sleep}
            track={colors.sleepSoft}
            center={sleep ? fmtPercent(sleep.amount * 100) : '--'}
            count={sleep ? { value: Math.round(sleep.amount * 100), decimals: 0, suffix: '%' } : null}
          />
        </PressableScale>
      </Card>
    </FadeIn>
  );
}

interface GaugeProps {
  label: string;
  value: number;
  max: number;
  color: string;
  track: string;
  /** What the ring says; also its accessibility label. */
  center: string;
  /** The number behind `center` when there is one, so it counts up as the ring fills; null shows `center` as is. */
  count: { value: number; decimals: number; suffix: string } | null;
  small?: boolean;
}

function Gauge(props: GaugeProps) {
  const variant = props.small ? 'label' : 'heading';
  return (
    <View style={styles.gauge}>
      <Ring size={SIZE} stroke={STROKE} value={props.value} max={props.max} color={props.color} track={props.track} accessibilityLabel={`${props.label} ${props.center}`}>
        {props.count ? (
          <CountUpText
            variant={variant}
            value={props.count.value}
            decimals={props.count.decimals}
            suffix={props.count.suffix}
            numberOfLines={1}
            adjustsFontSizeToFit
            style={styles.center}
          />
        ) : (
          <AppText variant={variant} numberOfLines={1} adjustsFontSizeToFit style={styles.center}>
            {props.center}
          </AppText>
        )}
      </Ring>
      <AppText variant="caption" muted>
        {props.label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
  gauge: { flex: 1, alignItems: 'center', gap: spacing.xs },
  center: { maxWidth: SIZE - 2 * STROKE - 8, textAlign: 'center', fontVariant: ['tabular-nums'] },
});

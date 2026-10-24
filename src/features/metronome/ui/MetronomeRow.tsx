import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Switch, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { fmtInt } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import { metronome, useMetronome } from '../metronome';
import { MAX_BPM, MIN_BPM, stepBpm } from '../metronomeModel';

/** One row to use during a workout: the cadence metronome's switch and its tempo in beats per minute (120 to 200, steps of 5). */
export function MetronomeRow() {
  const { t } = useTranslation('sharing');
  const { colors, fonts, radius } = useTheme();
  const { enabled, bpm } = useMetronome();

  const step = (direction: -1 | 1) => {
    const can = direction < 0 ? bpm > MIN_BPM : bpm < MAX_BPM;
    return (
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t(direction < 0 ? 'live.metronome.slower' : 'live.metronome.faster')}
        accessibilityState={{ disabled: !can }}
        disabled={!can}
        scaleTo={0.96}
        onPress={() => metronome.setBpm(stepBpm(bpm, direction))}
        style={[styles.step, { backgroundColor: colors.muted, borderRadius: radius.control, opacity: can ? 1 : 0.4 }]}>
        <Ionicons name={direction < 0 ? 'remove' : 'add'} size={24} color={colors.foreground} />
      </PressableScale>
    );
  };

  return (
    <View
      accessibilityRole="adjustable"
      accessibilityLabel={t('live.metronome.title')}
      accessibilityValue={{ text: t('live.metronome.value', { bpm: fmtInt(bpm) }) }}
      style={styles.row}>
      <Ionicons name="musical-notes" size={22} color={enabled ? colors.primary : colors.mutedForeground} />
      <View style={styles.text}>
        <AppText variant="bodyStrong">{t('live.metronome.title')}</AppText>
        <AppText variant="caption" muted>
          {t('live.metronome.hint')}
        </AppText>
      </View>
      {step(-1)}
      <AppText style={[styles.value, { fontFamily: fonts.numeral }]} numberOfLines={1}>
        {fmtInt(bpm)}
      </AppText>
      {step(1)}
      <Switch
        accessibilityLabel={t('live.metronome.title')}
        value={enabled}
        onValueChange={(value) => metronome.setEnabled(value)}
        trackColor={{ false: colors.switchOff, true: colors.primary }}
        thumbColor={enabled ? colors.primaryForeground : colors.card}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  text: { flex: 1, gap: 1 },
  step: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  value: { minWidth: 40, textAlign: 'center', fontSize: 18, fontVariant: ['tabular-nums'] },
});

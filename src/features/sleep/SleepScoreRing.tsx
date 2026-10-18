import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { CountUpText } from '@/components/motion';
import { Ring } from '@/components/Ring';
import type { SleepScoreRow } from '@/db/queries';
import { fmtInt, useTranslation } from '@/i18n';
import { useColors } from '@/theme';

/** The watch's sleep score out of 100 as a ring. The number is the watch's; JoyoFit does not compute one. */
export function SleepScoreRing({ score, size = 76 }: { score: SleepScoreRow; size?: number }) {
  const { t } = useTranslation('health');
  const colors = useColors();
  return (
    <Ring
      size={size}
      stroke={7}
      value={score.score}
      max={100}
      color={colors.sleep}
      track={colors.sleepSoft}
      accessibilityLabel={t('score.a11y', { score: fmtInt(score.score) })}>
      <View style={styles.center}>
        <CountUpText variant="heading" color={colors.sleepText} value={score.score} style={styles.value} />
        <AppText variant="caption" muted style={styles.caption}>
          {t('score.caption')}
        </AppText>
      </View>
    </Ring>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center' },
  value: { fontVariant: ['tabular-nums'] },
  caption: { fontSize: 11, lineHeight: 14 },
});

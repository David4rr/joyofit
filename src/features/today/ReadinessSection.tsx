import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { headlineHint, headlineLabel, type Readiness, type SignalTone } from '@/features/today/readiness';
import { spacing, useColors } from '@/theme';

/** Readiness headline with each signal behind it; signals without enough history say what they still need. */
export function ReadinessSection({ readiness }: { readiness: Readiness }) {
  const colors = useColors();
  const { t } = useTranslation('today');
  const toneColor = (tone: SignalTone) =>
    tone === 'good' ? colors.linkText : tone === 'bad' ? colors.heartText : colors.mutedForeground;

  return (
    <Section title={t('readiness.title')} icon="speedometer" tint="link">
      {readiness.headline ? (
        <View style={styles.head}>
          <AppText variant="heading">
            {readiness.recovery
              ? t('readiness.headlineRecovery', { headline: headlineLabel(readiness.headline), percent: readiness.recovery.percent })
              : headlineLabel(readiness.headline)}
          </AppText>
          <AppText variant="caption" muted>
            {headlineHint(readiness.headline)}
          </AppText>
        </View>
      ) : (
        <AppText variant="caption" muted>
          {t('readiness.notEnough')}
        </AppText>
      )}
      {readiness.signals.map((signal) => (
        <View key={signal.key} style={styles.signal}>
          <View style={styles.signalText}>
            <AppText variant="bodyStrong">{signal.title}</AppText>
            <AppText variant="caption" muted>
              {signal.detail}
            </AppText>
          </View>
          <AppText variant="bodyStrong" color={toneColor(signal.tone)}>
            {signal.value}
          </AppText>
        </View>
      ))}
      {readiness.missing.map((line) => (
        <AppText key={line} variant="caption" muted>
          {line}
        </AppText>
      ))}
      {readiness.hrvNote ? (
        <AppText variant="caption" muted>
          {readiness.hrvNote}
        </AppText>
      ) : null}
      <Details title={t('readiness.howTitle')}>
        {t(readiness.recovery ? 'readiness.howRecovery' : 'readiness.how')}
      </Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  head: { gap: 2 },
  signal: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  signalText: { flex: 1, gap: 2 },
});

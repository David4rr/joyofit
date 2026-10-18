import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { spacing, useTheme } from '@/theme';

/** A numbered list: a round number chip, then the text. */
export function NumberedSteps({ steps }: { steps: readonly string[] }) {
  const { colors, fonts } = useTheme();
  return (
    <View style={styles.list}>
      {steps.map((step, index) => (
        <View key={step} style={styles.step}>
          <View style={[styles.number, { backgroundColor: colors.muted }]}>
            <AppText variant="label" style={{ fontFamily: fonts.bold, fontVariant: ['tabular-nums'] }}>
              {index + 1}
            </AppText>
          </View>
          <AppText variant="caption" style={styles.text}>
            {step}
          </AppText>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.sm },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  number: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  text: { flex: 1, paddingTop: 2 },
});

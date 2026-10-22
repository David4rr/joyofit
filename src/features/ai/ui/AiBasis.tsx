import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { PressableScale } from '@/components/PressableScale';
import { spacing, useColors } from '@/theme';
import type { ToolTrace } from '../tools';
import { basisLine, describeCall } from './basis';
import { modelShort } from './status';

/**
 * Under an answer: one collapsed line saying what the answer was based on ("Dasar jawaban: ringkasan 14 hari, tidur 7 hari, 3 latihan"),
 * opening to the exact calls the model made and which model answered. Dates and names only, never a health value.
 */
export function AiBasis({ trace, provider, model }: { trace: readonly ToolTrace[]; provider: string | null; model: string | null }) {
  const { t } = useTranslation('ai');
  const colors = useColors();
  const [open, setOpen] = useState(false);
  const line = basisLine(trace, t);
  return (
    <View style={styles.wrap}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={line}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
        scaleTo={0.99}
        onPress={() => setOpen((v) => !v)}
        style={styles.header}>
        <AppText variant="caption" muted style={styles.line}>
          {line}
        </AppText>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={14} color={colors.mutedForeground} />
      </PressableScale>
      {open ? (
        <View style={styles.body}>
          {trace.length === 0 ? (
            <AppText variant="caption" muted>
              {t('basis.noCalls')}
            </AppText>
          ) : (
            trace.map((entry, index) => {
              const { words, call } = describeCall(entry, t);
              return (
                <View key={index} style={styles.call}>
                  <AppText variant="caption">{words}</AppText>
                  <AppText variant="mono" muted selectable>
                    {call}
                  </AppText>
                </View>
              );
            })
          )}
          {model ? (
            <AppText variant="caption" muted>
              {provider ? t('basis.answeredBy', { model: modelShort(model), provider }) : t('basis.answeredByModel', { model: modelShort(model) })}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs, maxWidth: '85%' },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 28 },
  line: { flexShrink: 1 },
  body: { gap: spacing.sm, paddingBottom: spacing.xs },
  call: { gap: 1 },
});

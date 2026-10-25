import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { PressableScale } from '@/components/PressableScale';
import type { SportCategory } from '@/features/workouts/sportCategory';
import { useTranslation } from '@/i18n';
import { spacing, useTheme } from '@/theme';

import {
  getAvailableMetrics,
  getDefaultMetrics,
  MAX_CUSTOM_METRICS,
  MIN_CUSTOM_METRICS,
} from '../data/customMetrics';
import type { JsonObject } from '../subject';

interface Props {
  run: JsonObject;
  category: SportCategory;
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  onMaxLimit: () => void;
}

export function MetricCustomizer({ run, category, selectedIds, onChange, onMaxLimit }: Props) {
  const { colors, fonts, radius } = useTheme();
  const { t } = useTranslation('stickers');
  const [expanded, setExpanded] = useState(false);

  const available = useMemo(() => getAvailableMetrics(run, category), [run, category]);
  const defaults = useMemo(() => getDefaultMetrics(run, category), [run, category]);

  const isCustomized = useMemo(() => {
    if (selectedIds.length !== defaults.length) return true;
    const defSet = new Set(defaults);
    return selectedIds.some((id) => !defSet.has(id));
  }, [selectedIds, defaults]);

  if (available.length <= MIN_CUSTOM_METRICS) return null;

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      if (selectedIds.length > MIN_CUSTOM_METRICS) {
        onChange(selectedIds.filter((item) => item !== id));
      }
    } else {
      if (selectedIds.length < MAX_CUSTOM_METRICS) {
        onChange([...selectedIds, id]);
      } else {
        onMaxLimit();
      }
    }
  };

  return (
    <View style={[styles.root, { backgroundColor: colors.muted, borderRadius: radius.card }]}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={t('ui.customMetrics.title')}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((prev) => !prev)}
        style={styles.header}>
        <Ionicons name="stats-chart-outline" size={18} color={colors.foreground} />
        <AppText variant="label" style={[styles.title, { fontFamily: fonts.bold }]}>
          {t('ui.customMetrics.title')} ({selectedIds.length}/{MAX_CUSTOM_METRICS})
        </AppText>
        <View style={[styles.badge, { backgroundColor: colors.card }]}>
          <AppText variant="caption" muted={!isCustomized} style={{ fontFamily: fonts.medium }}>
            {isCustomized ? t('ui.customMetrics.customBadge') : t('ui.customMetrics.defaultBadge')}
          </AppText>
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.mutedForeground} />
      </PressableScale>

      {expanded ? (
        <View style={styles.content}>
          <View style={styles.subHeader}>
            <AppText variant="caption" muted style={{ fontFamily: fonts.medium }}>
              {t('ui.customMetrics.count', { max: MAX_CUSTOM_METRICS })}
            </AppText>
            {isCustomized ? (
              <PressableScale accessibilityRole="button" onPress={() => onChange(defaults)}>
                <AppText variant="caption" style={{ color: colors.primary, fontFamily: fonts.bold }}>
                  {t('ui.customMetrics.reset')}
                </AppText>
              </PressableScale>
            ) : null}
          </View>
          <View style={styles.chipGrid}>
            {available.map((m) => (
              <Chip
                key={m.id}
                role="checkbox"
                label={t(`label.${m.labelKey}` as 'label.time')}
                selected={selectedIds.includes(m.id)}
                onPress={() => toggle(m.id)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { overflow: 'hidden' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  title: { flex: 1 },
  badge: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: 8,
  },
  content: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
  },
  subHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  chipGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
});

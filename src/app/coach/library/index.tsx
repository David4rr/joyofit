import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { Input } from '@/components/Input';
import { Screen } from '@/components/Screen';
import { EmptyState } from '@/components/States';
import { exerciseName, searchExercises, type ExerciseSetting } from '@/features/coach/exercises';
import type { ExercisePattern } from '@/features/coach/exercises/types';
import { ExerciseRow } from '@/features/coach/ui/ExerciseRow';
import { fmtInt, getLocale, useLocale } from '@/i18n';
import { spacing } from '@/theme';

const PATTERNS: readonly ExercisePattern[] = ['squat', 'hinge', 'lunge', 'push_h', 'push_v', 'pull_h', 'pull_v', 'core', 'glute', 'calf', 'arms', 'cardio'];
const SETTINGS: readonly (ExerciseSetting | 'all')[] = ['all', 'home', 'gym'];

/** The exercise library: search by name, narrow by where you train and by movement. */
export default function LibraryScreen() {
  const { t } = useTranslation('coach');
  const locale = useLocale();
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [setting, setSetting] = useState<ExerciseSetting | 'all'>('all');
  const [pattern, setPattern] = useState<ExercisePattern | null>(null);

  const results = useMemo(
    () => searchExercises(query, locale, { ...(setting === 'all' ? {} : { setting }), ...(pattern ? { pattern } : {}) }),
    [query, locale, setting, pattern],
  );

  return (
    <Screen>
      <Input icon="search" value={query} onChangeText={setQuery} placeholder={t('library.search')} autoCorrect={false} autoCapitalize="none" />
      <View style={styles.chips}>
        {SETTINGS.map((s) => (
          <Chip key={s} label={t(`library.setting.${s}`)} selected={setting === s} onPress={() => setSetting(s)} />
        ))}
      </View>
      <View style={styles.chips}>
        {PATTERNS.map((p) => (
          <Chip key={p} label={t(`pattern.${p}`)} selected={pattern === p} onPress={() => setPattern(pattern === p ? null : p)} />
        ))}
      </View>
      <AppText variant="caption" muted>
        {t('library.count', { n: fmtInt(results.length) })}
      </AppText>
      {results.length === 0 ? (
        <EmptyState icon="search" title={t('library.empty')} description={t('library.credits')} />
      ) : (
        <View style={styles.list}>
          {results.map((def) => (
            <ExerciseRow
              key={def.id}
              def={def}
              title={exerciseName(def, getLocale())}
              subtitle={`${t(`pattern.${def.pattern}`)} \u00b7 ${t(`equipment.${def.equipment}`)}`}
              onPress={() => router.push({ pathname: '/coach/library/[id]', params: { id: def.id } })}
            />
          ))}
        </View>
      )}
      <AppText variant="caption" muted>
        {t('library.credits')}
      </AppText>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  list: { gap: spacing.xs },
});

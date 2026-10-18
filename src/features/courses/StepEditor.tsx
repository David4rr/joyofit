import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Input';
import { Segmented } from '@/components/Segmented';
import {
  distanceUnits,
  intensityKinds,
  sanitizeNumber,
  stepKinds,
  targetKinds,
  type StepDraft,
} from '@/features/courses/courseModel';
import { spacing } from '@/theme';

interface StepEditorProps {
  title: string;
  step: StepDraft;
  onChange: (patch: Partial<StepDraft>) => void;
  /** Move and remove buttons for this step. */
  actions?: ReactNode;
}

type TextKey =
  | 'minutes'
  | 'seconds'
  | 'distance'
  | 'paceFastMin'
  | 'paceFastSec'
  | 'paceSlowMin'
  | 'paceSlowSec'
  | 'rangeLow'
  | 'rangeHigh';

/** Converts the typed distance when the unit flips, so 400 m becomes 0.4 km instead of 400 km. */
function convertDistance(text: string, from: 'm' | 'km', to: 'm' | 'km'): string {
  const value = Number(text.replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(value) || from === to) return text;
  return to === 'km' ? String(value / 1000) : String(Math.round(value * 1000));
}

/** All fields of one step. Inputs keep what was typed; `courseModel.buildCourse` validates it. */
export function StepEditor({ title, step, onChange, actions }: StepEditorProps) {
  const { t } = useTranslation('watch');
  const number = (key: TextKey, decimal = false) => (text: string) =>
    onChange({ [key]: sanitizeNumber(text, decimal) } as Partial<StepDraft>);

  return (
    <View style={styles.step}>
      <View style={styles.header}>
        <AppText variant="bodyStrong" style={styles.title} numberOfLines={1}>
          {title}
        </AppText>
        {actions}
      </View>

      <View style={styles.chips} accessibilityRole="radiogroup">
        {stepKinds().map((kind) => (
          <Chip
            key={kind.value}
            label={kind.label}
            role="radio"
            selected={step.kind === kind.value}
            onPress={() => onChange({ kind: kind.value })}
          />
        ))}
      </View>

      <AppText variant="label" muted>
        {t('courses.endsAfter')}
      </AppText>
      <Segmented options={targetKinds()} value={step.target} onChange={(target) => onChange({ target })} />

      {step.target === 'time' ? (
        <View style={styles.pair}>
          <View style={styles.half}>
            <Field label={t('courses.minutes')} value={step.minutes} onChangeText={number('minutes')} keyboardType="number-pad" maxLength={4} />
          </View>
          <View style={styles.half}>
            <Field label={t('courses.seconds')} value={step.seconds} onChangeText={number('seconds')} keyboardType="number-pad" maxLength={2} />
          </View>
        </View>
      ) : null}
      {step.target === 'distance' ? (
        <>
          <Field
            label={step.distanceUnit === 'm' ? t('courses.distanceM') : t('courses.distanceKm')}
            value={step.distance}
            onChangeText={number('distance', step.distanceUnit === 'km')}
            keyboardType={step.distanceUnit === 'km' ? 'decimal-pad' : 'number-pad'}
            maxLength={8}
          />
          <Segmented
            options={distanceUnits()}
            value={step.distanceUnit}
            onChange={(unit) =>
              onChange({ distanceUnit: unit, distance: convertDistance(step.distance, step.distanceUnit, unit) })
            }
          />
        </>
      ) : null}

      <AppText variant="label" muted>
        {t('courses.effort')}
      </AppText>
      <View style={styles.chips} accessibilityRole="radiogroup">
        {intensityKinds().map((kind) => (
          <Chip
            key={kind.value}
            label={kind.label}
            role="radio"
            selected={step.intensity === kind.value}
            onPress={() => onChange({ intensity: kind.value })}
          />
        ))}
      </View>

      {step.intensity === 'pace' ? (
        <>
          <View style={styles.pair}>
            <View style={styles.half}>
              <Field label={t('courses.fasterMin')} value={step.paceFastMin} onChangeText={number('paceFastMin')} keyboardType="number-pad" maxLength={2} />
            </View>
            <View style={styles.half}>
              <Field label={t('courses.fasterSec')} value={step.paceFastSec} onChangeText={number('paceFastSec')} keyboardType="number-pad" maxLength={2} />
            </View>
          </View>
          <View style={styles.pair}>
            <View style={styles.half}>
              <Field label={t('courses.slowerMin')} value={step.paceSlowMin} onChangeText={number('paceSlowMin')} keyboardType="number-pad" maxLength={2} />
            </View>
            <View style={styles.half}>
              <Field label={t('courses.slowerSec')} value={step.paceSlowSec} onChangeText={number('paceSlowSec')} keyboardType="number-pad" maxLength={2} />
            </View>
          </View>
          <AppText variant="caption" muted>
            {t('courses.paceHint')}
          </AppText>
        </>
      ) : null}
      {step.intensity === 'hrPercent' || step.intensity === 'cadence' ? (
        <>
          <View style={styles.pair}>
            <View style={styles.half}>
              <Field
                label={step.intensity === 'hrPercent' ? t('courses.lowHr') : t('courses.lowCadence')}
                value={step.rangeLow}
                onChangeText={number('rangeLow')}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
            <View style={styles.half}>
              <Field
                label={step.intensity === 'hrPercent' ? t('courses.highHr') : t('courses.highCadence')}
                value={step.rangeHigh}
                onChangeText={number('rangeHigh')}
                keyboardType="number-pad"
                maxLength={3}
              />
            </View>
          </View>
          <AppText variant="caption" muted>
            {step.intensity === 'hrPercent' ? t('courses.hrHint') : t('courses.cadenceHint')}
          </AppText>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  step: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, minHeight: 48 },
  title: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pair: { flexDirection: 'row', gap: spacing.md },
  half: { flex: 1 },
});

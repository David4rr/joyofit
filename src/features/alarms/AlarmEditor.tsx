import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { Notice } from '@/components/States';
import { DayChips } from '@/features/alarms/DayChips';
import { parseBounded } from '@/features/alarms/alarmUtils';
import { spacing } from '@/theme';

export interface AlarmFormValues {
  hour: number;
  minute: number;
  repeat: number;
  /** Event alarms only. */
  name: string;
  /** Smart alarm only: how many minutes before the time the watch may wake you. */
  aheadMinutes: number;
}

interface AlarmEditorProps {
  initial: AlarmFormValues;
  kind: 'event' | 'smart';
  saving: boolean;
  onSave: (values: AlarmFormValues) => void;
  onCancel: () => void;
  onDelete?: () => void;
}

/** Time, days and (per kind) name or wake-up window of one alarm. Validation messages stay inside the form. */
export function AlarmEditor({ initial, kind, saving, onSave, onCancel, onDelete }: AlarmEditorProps) {
  const { t } = useTranslation(['watch', 'common']);
  const [hour, setHour] = useState(String(initial.hour));
  const [minute, setMinute] = useState(String(initial.minute));
  const [name, setName] = useState(initial.name);
  const [ahead, setAhead] = useState(String(initial.aheadMinutes));
  const [repeat, setRepeat] = useState(initial.repeat);
  const [problem, setProblem] = useState<string | null>(null);

  const save = () => {
    const h = parseBounded(hour, 0, 23);
    const m = parseBounded(minute, 0, 59);
    const a = parseBounded(ahead, 0, 127);
    if (h === null) return setProblem(t('watch:alarms.editor.hourRange'));
    if (m === null) return setProblem(t('watch:alarms.editor.minuteRange'));
    if (kind === 'smart' && a === null) return setProblem(t('watch:alarms.editor.aheadRange'));
    setProblem(null);
    onSave({
      hour: h,
      minute: m,
      repeat,
      name: name.trim() || t('watch:alarms.defaultName'),
      aheadMinutes: a ?? initial.aheadMinutes,
    });
  };

  return (
    <View style={styles.form}>
      <View style={styles.timeRow}>
        <View style={styles.time}>
          <Field label={t('watch:alarms.editor.hour')} value={hour} onChangeText={setHour} keyboardType="number-pad" maxLength={3} />
        </View>
        <View style={styles.time}>
          <Field label={t('watch:alarms.editor.minute')} value={minute} onChangeText={setMinute} keyboardType="number-pad" maxLength={3} />
        </View>
      </View>
      {kind === 'event' ? <Field label={t('watch:alarms.editor.name')} value={name} onChangeText={setName} maxLength={64} icon="pricetag" /> : null}
      {kind === 'smart' ? (
        <Field
          label={t('watch:alarms.editor.ahead')}
          value={ahead}
          onChangeText={setAhead}
          keyboardType="number-pad"
          maxLength={3}
        />
      ) : null}
      <View style={styles.repeat}>
        <AppText variant="label" muted>
          {t('watch:alarms.editor.repeat')}
        </AppText>
        <DayChips value={repeat} onChange={setRepeat} />
        <AppText variant="caption" muted>
          {t('watch:alarms.editor.repeatHint')}
        </AppText>
      </View>
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      <Button label={t('watch:alarms.editor.save')} variant="primary" icon="checkmark" loading={saving} onPress={save} />
      <Button label={t('common:actions.cancel')} disabled={saving} onPress={onCancel} />
      {onDelete ? <Button label={t('watch:alarms.editor.delete')} variant="destructive" icon="trash" disabled={saving} onPress={onDelete} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  form: { gap: spacing.md },
  timeRow: { flexDirection: 'row', gap: spacing.md },
  time: { flex: 1 },
  repeat: { gap: 2 },
});

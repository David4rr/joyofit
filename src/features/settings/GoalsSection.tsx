import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { Field } from '@/components/Input';
import { Divider, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { HuaweiWear, type ActivityGoals } from '@/wear';
import { spacing } from '@/theme';

/** Huawei Health's defaults: 10 000 steps, 300 active kcal, 30 exercise minutes, 12 stand hours, all reminders on. */
const HUAWEI_DEFAULTS: ActivityGoals = {
  steps: 10_000,
  calories: 300,
  exerciseMinutes: 30,
  standHours: 12,
  remindStand: true,
  remindProgress: true,
  remindGoalReached: true,
};

interface Fields {
  steps: string;
  calories: string;
  exercise: string;
  stand: string;
}

const toFields = (goals: ActivityGoals): Fields => ({
  steps: String(goals.steps),
  calories: String(goals.calories),
  exercise: String(goals.exerciseMinutes),
  stand: String(goals.standHours),
});

function whole(text: string, min: number, max: number, what: string): number | string {
  const n = Number(text.trim());
  if (!Number.isInteger(n) || n < min || n > max) return `${what} must be a whole number from ${min} to ${max}.`;
  return n;
}

/** The four goals from the form, or the first message that explains what is out of range. */
function parseFields(fields: Fields, reminders: Pick<ActivityGoals, 'remindStand' | 'remindProgress' | 'remindGoalReached'>): ActivityGoals | string {
  const steps = whole(fields.steps, 1000, 100_000, 'Steps goal');
  const calories = whole(fields.calories, 50, 10_000, 'Calories goal');
  const exerciseMinutes = whole(fields.exercise, 1, 600, 'Exercise goal');
  const standHours = whole(fields.stand, 1, 24, 'Stand goal');
  for (const value of [steps, calories, exerciseMinutes, standHours]) if (typeof value === 'string') return value;
  return { steps: steps as number, calories: calories as number, exerciseMinutes: exerciseMinutes as number, standHours: standHours as number, ...reminders };
}

/** Activity-ring goals and reminders, sent to the watch on save and on every connect. */
export function GoalsSection() {
  const [status, setStatus] = useState(() => HuaweiWear.getActivityGoals());
  const [fields, setFields] = useState<Fields>(() => toFields(HuaweiWear.getActivityGoals()));
  const [message, setMessage] = useState<{ text: string; danger: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(() => setStatus(HuaweiWear.getActivityGoals()), []);
  useNativeRefresh(reload);

  const edit = (key: keyof Fields) => (text: string) => {
    setFields((current) => ({ ...current, [key]: text }));
    setMessage(null);
  };

  const apply = async (goals: ActivityGoals) => {
    setBusy(true);
    setMessage(null);
    try {
      const sent = await HuaweiWear.setActivityGoals(goals);
      setMessage({ text: sent ? 'Sent to the watch.' : 'Saved. It is sent the next time the watch connects.', danger: false });
    } catch (e) {
      setMessage({ text: errorMessage(e), danger: true });
    } finally {
      setBusy(false);
      reload();
    }
  };

  const save = () => {
    const parsed = parseFields(fields, status);
    if (typeof parsed === 'string') setMessage({ text: parsed, danger: true });
    else void apply(parsed);
  };

  // A reminder switch applies at once, with the goals as last saved (unsaved edits in the boxes stay as typed).
  const toggle = (key: 'remindStand' | 'remindProgress' | 'remindGoalReached') => (value: boolean) =>
    void apply({
      steps: status.steps,
      calories: status.calories,
      exerciseMinutes: status.exerciseMinutes,
      standHours: status.standHours,
      remindStand: status.remindStand,
      remindProgress: status.remindProgress,
      remindGoalReached: status.remindGoalReached,
      [key]: value,
    });

  const reset = () => {
    setFields(toFields(HUAWEI_DEFAULTS));
    void apply(HUAWEI_DEFAULTS);
  };

  return (
    <Section title="Activity goals" icon="flag">
      <View style={styles.row}>
        <View style={styles.cell}>
          <Field label="Steps / day" icon="footsteps" keyboardType="number-pad" value={fields.steps} onChangeText={edit('steps')} />
        </View>
        <View style={styles.cell}>
          <Field label="Active kcal" icon="flame" keyboardType="number-pad" value={fields.calories} onChangeText={edit('calories')} />
        </View>
      </View>
      <View style={styles.row}>
        <View style={styles.cell}>
          <Field label="Exercise (min)" icon="timer" keyboardType="number-pad" value={fields.exercise} onChangeText={edit('exercise')} />
        </View>
        <View style={styles.cell}>
          <Field label="Stand (hours)" icon="body" keyboardType="number-pad" value={fields.stand} onChangeText={edit('stand')} />
        </View>
      </View>
      {message ? <Notice tone={message.danger ? 'danger' : 'info'}>{message.text}</Notice> : null}
      <ButtonRow>
        <Button label="Save and send" variant="primary" icon="send" loading={busy} onPress={save} />
        <Button label="Huawei defaults" variant="secondary" disabled={busy} onPress={reset} />
      </ButtonRow>
      <Divider />
      <SwitchRow
        icon="walk"
        label="Stand reminder"
        value={status.remindStand}
        disabled={busy}
        onValueChange={toggle('remindStand')}
      />
      <SwitchRow
        icon="speedometer"
        label="Progress reminder"
        value={status.remindProgress}
        disabled={busy}
        onValueChange={toggle('remindProgress')}
      />
      <SwitchRow
        icon="trophy"
        label="Goal reached"
        value={status.remindGoalReached}
        disabled={busy}
        onValueChange={toggle('remindGoalReached')}
      />
      <PairGrid>
        <Pair
          label="Watch accepts goals"
          value={status.configSupported === null ? 'Not connected' : status.configSupported ? 'Yes' : 'Not in its capabilities'}
        />
        <Pair label="Last send" value={status.lastSentAt ? formatDateTime(status.lastSentAt / 1000) : null} />
      </PairGrid>
      <Details>
        The three rings and the calorie goal on the watch. The steps goal is also your daily step goal in Profile and
        goal. Sent on save and whenever the watch connects. Stand reminder: the watch nudges you when you have been
        sitting. Progress reminder: tells you how far along the day&apos;s goals are. Goal reached: celebrates when a
        ring closes.
      </Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  cell: { flex: 1 },
});

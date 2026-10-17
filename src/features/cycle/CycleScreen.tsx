import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { Details } from '@/components/Details';
import { Field } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { LoadingState, Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';
import { HuaweiWear, type CycleOverview, type CycleSwitches } from '@/wear';

const LEVELS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Light' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Heavy' },
] as const;

const CRAMPS = [
  { value: 0, label: 'None' },
  { value: 1, label: 'Mild' },
  { value: 2, label: 'Medium' },
  { value: 3, label: 'Strong' },
] as const;

/** `YYYY-MM-DD` plus `offset` days, computed on the calendar date so daylight saving never shifts it. */
function shiftDay(day: string, offset: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + offset));
  return shifted.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both `YYYY-MM-DD`). */
function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

/** `Oct 14`, in the phone's language. */
function formatDay(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

const SWITCH_ROWS: readonly { key: keyof CycleSwitches; label: string }[] = [
  { key: 'periodStart', label: 'Period is about to start' },
  { key: 'periodEnd', label: 'Period is about to end' },
  { key: 'fertileStart', label: 'Fertile window is about to start' },
  { key: 'fertileEnd', label: 'Fertile window is about to end' },
  { key: 'easyPregnancy', label: 'Easy-pregnancy reminders' },
];

/**
 * The menstrual cycle log: period start and end, flow, cramps, an average-cycle estimate of the next period, and the switch
 * that shows the calendar and reminders on the watch. Everything stays in the phone's own database.
 */
export function CycleScreen() {
  const [cycle, setCycle] = useState<CycleOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [pastStart, setPastStart] = useState('');
  const [pastEnd, setPastEnd] = useState('');

  const load = useCallback(async () => {
    try {
      setCycle(await HuaweiWear.getCycle());
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useNativeRefresh(() => void load());

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (!cycle) {
    return error ? <Notice tone="danger">{error}</Notice> : <LoadingState label="Loading your cycle log" />;
  }

  const selected = shiftDay(cycle.today, -offset);
  const logged = cycle.days.find((d) => d.day === selected);
  const flow = logged?.flow ?? 0;
  const cramps = logged?.cramps ?? 0;
  const next = cycle.predictions[0];
  const untilNext = next ? daysBetween(cycle.today, next.start) : null;
  const periods = [...cycle.periods].reverse().slice(0, 6);

  const setSwitch = (key: keyof CycleSwitches, value: boolean) =>
    run(() => HuaweiWear.setCycleSwitches({ ...cycle.switches, [key]: value }));

  return (
    <>
      <Notice>Estimates only, not medical advice. Do not use them to avoid or plan a pregnancy.</Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Section title="Next period" icon="calendar" tint="heart">
        {next ? (
          <>
            <PairGrid>
              <Pair
                label="Estimated start"
                value={
                  cycle.daysLate > 0
                    ? `${formatDay(next.start)} (${cycle.daysLate} day${cycle.daysLate === 1 ? '' : 's'} late)`
                    : `${formatDay(next.start)} (${untilNext === 0 ? 'today' : `in ${untilNext} days`})`
                }
              />
              <Pair label="Estimated length" value={`${cycle.averagePeriodDays} days`} />
              <Pair label="Fertile window" value={`${formatDay(next.fertileStart)} to ${formatDay(next.fertileEnd)}`} />
              <Pair label="Average cycle" value={`${cycle.averageCycleDays} days`} />
            </PairGrid>
            <Details>
              {'The next period and the fertile window before it are estimated from the average of your logged cycles. They cannot tell irregular cycles, illness, stress, hormones or pregnancy.'}
            </Details>
          </>
        ) : (
          <>
            <AppText variant="caption" muted>
              Log a period to get an estimate.
            </AppText>
            <Details>
              {'Log the first day of a period and JoyoFit estimates the next one. With one cycle it assumes 28 days, with more it averages them. Estimates cannot tell irregular cycles, illness, stress, hormones or pregnancy.'}
            </Details>
          </>
        )}
      </Section>

      <Section title="Log" icon="create" tint="heart">
        <View style={styles.chips}>
          {[0, 1, 2].map((n) => (
            <Chip
              key={n}
              label={n === 0 ? 'Today' : n === 1 ? 'Yesterday' : formatDay(shiftDay(cycle.today, -n))}
              selected={offset === n}
              onPress={() => setOffset(n)}
            />
          ))}
        </View>
        {cycle.periodOngoing ? (
          <Button
            label={`Period ended ${offset === 0 ? 'today' : formatDay(selected)}`}
            variant="primary"
            icon="checkmark"
            disabled={busy}
            onPress={() => run(() => HuaweiWear.endPeriod(selected))}
          />
        ) : (
          <Button
            label={`Period started ${offset === 0 ? 'today' : formatDay(selected)}`}
            variant="primary"
            icon="water"
            disabled={busy}
            onPress={() => run(() => HuaweiWear.startPeriod(selected))}
          />
        )}
        <AppText variant="label" muted>
          Flow on {offset === 0 ? 'today' : formatDay(selected)}
        </AppText>
        <Segmented
          options={LEVELS}
          value={flow}
          disabled={busy}
          onChange={(value) => run(() => HuaweiWear.logCycleDay(selected, value, cramps))}
        />
        <AppText variant="label" muted>
          Cramps
        </AppText>
        <Segmented
          options={CRAMPS}
          value={cramps}
          disabled={busy}
          onChange={(value) => run(() => HuaweiWear.logCycleDay(selected, flow, value))}
        />
      </Section>

      <Section title="Periods you logged" icon="list">
        {periods.length === 0 ? (
          <AppText variant="caption" muted>
            Nothing logged yet.
          </AppText>
        ) : (
          periods.map((p) => (
            <View key={p.start} style={styles.periodRow}>
              <View style={styles.periodText}>
                <AppText variant="bodyStrong">
                  {formatDay(p.start)}
                  {p.end ? ` to ${formatDay(p.end)}` : ' (going on)'}
                </AppText>
                {p.end ? (
                  <AppText variant="caption" muted>
                    {daysBetween(p.start, p.end) + 1} days
                  </AppText>
                ) : null}
              </View>
              <Button
                label="Delete"
                variant="destructive"
                disabled={busy}
                onPress={() => run(() => HuaweiWear.deletePeriod(p.start))}
              />
            </View>
          ))
        )}
        <AppText variant="label" muted>
          Add an earlier period
        </AppText>
        <View style={styles.dates}>
          <View style={styles.date}>
            <Field label="First day" placeholder="YYYY-MM-DD" value={pastStart} onChangeText={setPastStart} autoCapitalize="none" />
          </View>
          <View style={styles.date}>
            <Field label="Last day" placeholder="YYYY-MM-DD" value={pastEnd} onChangeText={setPastEnd} autoCapitalize="none" />
          </View>
        </View>
        <Button
          label="Add period"
          icon="add"
          disabled={busy || pastStart.length !== 10 || pastEnd.length !== 10}
          onPress={() =>
            run(async () => {
              await HuaweiWear.addPeriod(pastStart, pastEnd);
              setPastStart('');
              setPastEnd('');
            })
          }
        />
      </Section>

      <Section title="On the watch" icon="watch">
        <SwitchRow
          icon="calendar"
          label="Cycle calendar on the watch"
          hint={cycle.watchSupported ? undefined : `Not available right now: ${cycle.watchNote}.`}
          value={cycle.enabled}
          disabled={busy}
          onValueChange={(enabled) => run(() => HuaweiWear.setCycleEnabled(enabled))}
        />
        {cycle.enabled ? (
          <>
            <SwitchRow
              icon="notifications"
              label="Reminders on the watch"
              value={cycle.switches.master}
              disabled={busy}
              onValueChange={(value) => setSwitch('master', value)}
            />
            {SWITCH_ROWS.filter((row) => row.key !== 'easyPregnancy' || cycle.easyPregnancySwitch).map((row) => (
              <SwitchRow
                key={row.key}
                label={row.label}
                value={cycle.switches[row.key]}
                disabled={busy || !cycle.switches.master}
                onValueChange={(value) => setSwitch(row.key, value)}
              />
            ))}
          </>
        ) : null}
        <Details>
          {cycle.watchSupported
            ? 'Sends your estimates and symptoms to the watch when it asks. Off by default.'
            : 'Sent on the next connection with a watch that supports it.'}
          {' The reminders switch is the master switch for the reminders below it.'}
        </Details>
      </Section>
    </>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  periodRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  periodText: { flex: 1, gap: 2 },
  dates: { flexDirection: 'row', gap: spacing.md },
  date: { flex: 1 },
});

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
import { fmtDay } from '@/i18n';
import { spacing } from '@/theme';
import { HuaweiWear, type CycleOverview, type CycleSwitches } from '@/wear';

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

/** `Oct 14` / `14 Okt`, in the app's language. */
function formatDay(day: string): string {
  return fmtDay(day, 'short');
}

const SWITCH_ROWS = ['periodStart', 'periodEnd', 'fertileStart', 'fertileEnd', 'easyPregnancy'] as const satisfies readonly (keyof CycleSwitches)[];

/**
 * The menstrual cycle log: period start and end, flow, cramps, an average-cycle estimate of the next period, and the switch
 * that shows the calendar and reminders on the watch. Everything stays in the phone's own database.
 */
export function CycleScreen() {
  const { t } = useTranslation(['today', 'common']);
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
    return error ? <Notice tone="danger">{error}</Notice> : <LoadingState label={t('cycle.loading')} />;
  }

  const selected = shiftDay(cycle.today, -offset);
  const logged = cycle.days.find((d) => d.day === selected);
  const flow = logged?.flow ?? 0;
  const cramps = logged?.cramps ?? 0;
  const levels = [
    { value: 0, label: t('cycle.level.none') },
    { value: 1, label: t('cycle.level.light') },
    { value: 2, label: t('cycle.level.medium') },
    { value: 3, label: t('cycle.level.heavy') },
  ];
  const crampLevels = [
    { value: 0, label: t('cycle.cramp.none') },
    { value: 1, label: t('cycle.cramp.mild') },
    { value: 2, label: t('cycle.cramp.medium') },
    { value: 3, label: t('cycle.cramp.strong') },
  ];
  const next = cycle.predictions[0];
  const untilNext = next ? daysBetween(cycle.today, next.start) : null;
  const periods = [...cycle.periods].reverse().slice(0, 6);

  const setSwitch = (key: keyof CycleSwitches, value: boolean) =>
    run(() => HuaweiWear.setCycleSwitches({ ...cycle.switches, [key]: value }));

  return (
    <>
      <Notice>{t('cycle.disclaimer')}</Notice>
      {error ? <Notice tone="danger">{error}</Notice> : null}

      <Section title={t('cycle.next.title')} icon="calendar" tint="heart">
        {next ? (
          <>
            <PairGrid>
              <Pair
                label={t('cycle.next.estimatedStart')}
                value={
                  cycle.daysLate > 0
                    ? t('cycle.next.late', { date: formatDay(next.start), count: cycle.daysLate })
                    : untilNext === 0
                      ? t('cycle.next.dueToday', { date: formatDay(next.start) })
                      : t('cycle.next.dueIn', { date: formatDay(next.start), count: untilNext ?? 0 })
                }
              />
              <Pair label={t('cycle.next.estimatedLength')} value={t('cycle.next.days', { count: cycle.averagePeriodDays })} />
              <Pair
                label={t('cycle.next.fertile')}
                value={t('cycle.next.fertileRange', { start: formatDay(next.fertileStart), end: formatDay(next.fertileEnd) })}
              />
              <Pair label={t('cycle.next.averageCycle')} value={t('cycle.next.days', { count: cycle.averageCycleDays })} />
            </PairGrid>
            <Details>{t('cycle.next.details')}</Details>
          </>
        ) : (
          <>
            <AppText variant="caption" muted>
              {t('cycle.next.emptyHint')}
            </AppText>
            <Details>{t('cycle.next.emptyDetails')}</Details>
          </>
        )}
      </Section>

      <Section title={t('cycle.log.title')} icon="create" tint="heart">
        <View style={styles.chips}>
          {[0, 1, 2].map((n) => (
            <Chip
              key={n}
              label={n === 0 ? t('common:time.today') : n === 1 ? t('common:time.yesterday') : formatDay(shiftDay(cycle.today, -n))}
              selected={offset === n}
              onPress={() => setOffset(n)}
            />
          ))}
        </View>
        {cycle.periodOngoing ? (
          <Button
            label={offset === 0 ? t('cycle.log.endedToday') : t('cycle.log.endedOn', { date: formatDay(selected) })}
            variant="primary"
            icon="checkmark"
            disabled={busy}
            onPress={() => run(() => HuaweiWear.endPeriod(selected))}
          />
        ) : (
          <Button
            label={offset === 0 ? t('cycle.log.startedToday') : t('cycle.log.startedOn', { date: formatDay(selected) })}
            variant="primary"
            icon="water"
            disabled={busy}
            onPress={() => run(() => HuaweiWear.startPeriod(selected))}
          />
        )}
        <AppText variant="label" muted>
          {offset === 0 ? t('cycle.log.flowToday') : t('cycle.log.flowOn', { date: formatDay(selected) })}
        </AppText>
        <Segmented
          options={levels}
          value={flow}
          disabled={busy}
          onChange={(value) => run(() => HuaweiWear.logCycleDay(selected, value, cramps))}
        />
        <AppText variant="label" muted>
          {t('cycle.log.cramps')}
        </AppText>
        <Segmented
          options={crampLevels}
          value={cramps}
          disabled={busy}
          onChange={(value) => run(() => HuaweiWear.logCycleDay(selected, flow, value))}
        />
      </Section>

      <Section title={t('cycle.periods.title')} icon="list">
        {periods.length === 0 ? (
          <AppText variant="caption" muted>
            {t('cycle.periods.none')}
          </AppText>
        ) : (
          periods.map((p) => (
            <View key={p.start} style={styles.periodRow}>
              <View style={styles.periodText}>
                <AppText variant="bodyStrong">
                  {p.end
                    ? t('cycle.periods.range', { start: formatDay(p.start), end: formatDay(p.end) })
                    : t('cycle.periods.ongoing', { start: formatDay(p.start) })}
                </AppText>
                {p.end ? (
                  <AppText variant="caption" muted>
                    {t('cycle.periods.length', { count: daysBetween(p.start, p.end) + 1 })}
                  </AppText>
                ) : null}
              </View>
              <Button
                label={t('common:actions.delete')}
                variant="destructive"
                disabled={busy}
                onPress={() => run(() => HuaweiWear.deletePeriod(p.start))}
              />
            </View>
          ))
        )}
        <AppText variant="label" muted>
          {t('cycle.periods.addEarlier')}
        </AppText>
        <View style={styles.dates}>
          <View style={styles.date}>
            <Field
              label={t('cycle.periods.firstDay')}
              placeholder="YYYY-MM-DD" // i18n-ok: ISO date input format
              value={pastStart}
              onChangeText={setPastStart}
              autoCapitalize="none"
            />
          </View>
          <View style={styles.date}>
            <Field
              label={t('cycle.periods.lastDay')}
              placeholder="YYYY-MM-DD" // i18n-ok: ISO date input format
              value={pastEnd}
              onChangeText={setPastEnd}
              autoCapitalize="none"
            />
          </View>
        </View>
        <Button
          label={t('cycle.periods.add')}
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

      <Section title={t('cycle.watch.title')} icon="watch">
        <SwitchRow
          icon="calendar"
          label={t('cycle.watch.calendar')}
          hint={cycle.watchSupported ? undefined : t('cycle.watch.unavailable', { note: cycle.watchNote })}
          value={cycle.enabled}
          disabled={busy}
          onValueChange={(enabled) => run(() => HuaweiWear.setCycleEnabled(enabled))}
        />
        {cycle.enabled ? (
          <>
            <SwitchRow
              icon="notifications"
              label={t('cycle.watch.reminders')}
              value={cycle.switches.master}
              disabled={busy}
              onValueChange={(value) => setSwitch('master', value)}
            />
            {SWITCH_ROWS.filter((key) => key !== 'easyPregnancy' || cycle.easyPregnancySwitch).map((key) => (
              <SwitchRow
                key={key}
                label={t(`cycle.watch.${key}`)}
                value={cycle.switches[key]}
                disabled={busy || !cycle.switches.master}
                onValueChange={(value) => setSwitch(key, value)}
              />
            ))}
          </>
        ) : null}
        <Details>{t(cycle.watchSupported ? 'cycle.watch.detailsSupported' : 'cycle.watch.detailsPending')}</Details>
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

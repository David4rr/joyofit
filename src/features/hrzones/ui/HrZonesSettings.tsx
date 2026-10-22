import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Chip } from '@/components/Chip';
import { Details } from '@/components/Details';
import { Divider, Screen, Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { useToast } from '@/components/Toast';
import { showsWatchUi } from '@/features/device/presence';
import { useWatchPresence } from '@/features/device/useWatchPresence';
import { listWorkoutsSince } from '@/db/queries';
import { useLactateTest } from '@/features/lactate/lactate';
import { watchLactate, type LactateValue } from '@/features/lactate/values';
import { parseSummary } from '@/features/workouts/summary';
import { useAnalysisPalette } from '@/features/workouts/analysis/palette';
import { hrZoneColor } from '@/features/workouts/analysis/ui';
import { fmtInt } from '@/i18n';
import { spacing } from '@/theme';
import { hasNative, HuaweiWear } from '@/wear';

import { getHrZoneSettings, saveHrZoneSettings, userAge, type WatchZonesOutcome } from '../settings';
import { loadZoneSuggestion } from '../suggest';
import {
  DEFAULT_HR_ZONE_SETTINGS,
  HR_ZONE_COUNT,
  MAX_HR_MAX,
  MAX_HR_MIN,
  REST_HR_GAP,
  REST_HR_MAX,
  REST_HR_MIN,
  LTHR_MIN,
  WARNING_MIN,
  ZONE_NAME_KEYS,
  estimateLthr,
  clampRest,
  maxHrFromAge,
  maxHrTanaka,
  moveLimit,
  resolveHrZones,
  sameSettings,
  zoneRange,
  type HrZoneMethod,
  type HrZoneSettings,
  type HrZoneSuggestion,
} from '../zones';
import { BpmStepper } from './BpmStepper';

const WATCH_LTHR_DAYS = 120;

/** The lactate thresholds worth offering: the saved time trial and the newest one the watch sent with a workout. */
function useLthrSources(): { test: LactateValue | null; watch: LactateValue | null } {
  const db = useSQLiteContext();
  const test = useLactateTest();
  const [watch, setWatch] = useState<LactateValue | null>(null);
  useEffect(() => {
    let cancelled = false;
    const nowSec = Math.floor(Date.now() / 1000);
    listWorkoutsSince(db, nowSec - WATCH_LTHR_DAYS * 86_400, nowSec + 60, -1).then(
      (rows) => {
        if (!cancelled) setWatch(watchLactate(rows.map(({ workout, summaryJson }) => ({ workout, summary: parseSummary(summaryJson) }))));
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [db]);
  return { test, watch };
}

type Suggestion = { status: 'idle' } | { status: 'loading' } | { status: 'done'; value: HrZoneSuggestion } | { status: 'failed' };

/** One labelled row with a stepper on the right; the label and an optional second line take the rest of the width. */
function StepperRow({ title, caption, color, children }: { title: string; caption?: string; color?: string; children: React.ReactNode }) {
  return (
    <View style={styles.stepperRow}>
      {color ? <View style={[styles.swatch, { backgroundColor: color }]} /> : null}
      <View style={styles.stepperText}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        {caption ? (
          <AppText variant="caption" muted numberOfLines={1}>
            {caption}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/**
 * Settings > Zona HR: how heart-rate zones are calculated (maximum heart rate or heart rate reserve), the maximum and resting heart rate, the
 * five zone limits in bpm and the watch's heart-rate limit alert. The draft is applied with "Simpan": every screen that shows zones follows,
 * and the zones go to the watch (docs/hr-zones.md).
 */
export function HrZonesSettings() {
  const { t } = useTranslation('settings');
  const router = useRouter();
  const db = useSQLiteContext();
  const palette = useAnalysisPalette();
  const presence = useWatchPresence();
  const { toast, show } = useToast();
  const withWatch = presence === null || showsWatchUi(presence);

  const [stored, setStored] = useState(getHrZoneSettings);
  const [draft, setDraft] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [suggestion, setSuggestion] = useState<Suggestion>({ status: 'idle' });
  const [age] = useState(userAge);
  const hasProfile = useMemo(() => (HuaweiWear.getUserProfile()?.birthYear ?? 0) > 0, []);

  const zones = useMemo(() => resolveHrZones(draft, age), [draft, age]);
  const measured = useLthrSources();
  const dirty = !sameSettings(draft, stored);
  const isDefault = sameSettings(draft, DEFAULT_HR_ZONE_SETTINGS);
  const formulaMax = maxHrFromAge(age);
  const tanakaMax = maxHrTanaka(age);
  const restMax = Math.min(REST_HR_MAX, zones.maxHr - REST_HR_GAP);

  const edit = (patch: Partial<HrZoneSettings>) => setDraft((current) => ({ ...current, ...patch }));
  // Editing the maximum, the resting rate or the method derives the limits again: hand-edited limits belong to the numbers they were set against.
  const setMethod = (method: HrZoneMethod) => edit({ method, limits: null });
  const setMaxHr = (maxHr: number | null) => edit({ maxHr, limits: null, restingHr: draft.restingHr === null ? null : clampRest(draft.restingHr, maxHr ?? formulaMax) });
  const setRestingHr = (restingHr: number) => edit({ restingHr, limits: draft.method === 'max' ? draft.limits : null });
  const setLthr = (lthr: number | null) => edit({ lthr, limits: null });
  const setLimit = (index: number, value: number) => edit({ limits: moveLimit(zones.limits, index, value, zones.maxHr) });

  const outcomeText = (outcome: WatchZonesOutcome): string => {
    if (outcome === 'sent') return t('hrZones.saved.sent');
    if (outcome === 'unsupported') return t('hrZones.saved.unsupported');
    if (outcome === 'failed') return t('hrZones.saved.failed');
    return hasNative('getHeartRateZonesStatus') && HuaweiWear.getHeartRateZonesStatus().via === 'none' ? t('hrZones.saved.none') : t('hrZones.saved.stored');
  };

  const save = async () => {
    setSaving(true);
    try {
      const next: HrZoneSettings = { ...draft, limits: zones.custom ? [...zones.limits] : null };
      const outcome = await saveHrZoneSettings(next);
      // Heart-rate load of a ride is cached per ride; it follows the zones, so it is worked out again.
      await db.runAsync('DELETE FROM ride_metrics');
      setStored(next);
      setDraft(next);
      show(outcomeText(outcome));
    } finally {
      setSaving(false);
    }
  };

  const calculate = async () => {
    setSuggestion({ status: 'loading' });
    try {
      setSuggestion({ status: 'done', value: await loadZoneSuggestion(db, age) });
    } catch {
      setSuggestion({ status: 'failed' });
    }
  };

  const watchNote = (): string | null => {
    if (!withWatch) return null;
    if (!hasNative('getHeartRateZonesStatus')) return t('hrZones.watch.noNative');
    const { via } = HuaweiWear.getHeartRateZonesStatus();
    if (via === null) return t('hrZones.watch.offline');
    return via === 'none' ? t('hrZones.watch.none') : t('hrZones.watch.ok');
  };
  const note = watchNote();
  const found = suggestion.status === 'done' ? suggestion.value : null;

  return (
    <Screen
      footer={
        <View style={styles.footer}>
          <ButtonRow>
            <Button label={t('hrZones.reset')} variant="secondary" icon="refresh" disabled={isDefault || saving} onPress={() => setDraft(DEFAULT_HR_ZONE_SETTINGS)} />
            <Button label={t('hrZones.save')} variant="primary" icon="checkmark" disabled={!dirty} loading={saving} onPress={() => void save()} />
          </ButtonRow>
        </View>
      }>
      <Section title={t('hrZones.method.title')} icon="pulse" tint="heart">
        <Segmented
          value={draft.method}
          onChange={setMethod}
          options={[
            { value: 'max', label: t('hrZones.method.max') },
            { value: 'hrr', label: t('hrZones.method.hrr') },
            { value: 'lthr', label: t('hrZones.method.lthr') },
          ]}
        />
        <AppText variant="caption" muted>
          {t(draft.method === 'max' ? 'hrZones.method.maxBody' : draft.method === 'hrr' ? 'hrZones.method.hrrBody' : 'hrZones.method.lthrBody')}
        </AppText>
      </Section>

      <Section title={t('hrZones.rates.title')} icon="heart">
        <StepperRow title={t('hrZones.rates.max')} caption={draft.maxHr === null ? t('hrZones.rates.maxFromAge', { age: fmtInt(age) }) : t('hrZones.rates.maxSet')}>
          <BpmStepper
            label={t('hrZones.rates.max')}
            lessLabel={t('hrZones.less')}
            moreLabel={t('hrZones.more')}
            value={zones.maxHr}
            min={MAX_HR_MIN}
            max={MAX_HR_MAX}
            onChange={setMaxHr}
          />
        </StepperRow>
        <View style={styles.chips}>
          <Chip label={t('hrZones.rates.formulaClassic', { bpm: fmtInt(formulaMax) })} selected={draft.maxHr === null} onPress={() => setMaxHr(null)} />
          <Chip label={t('hrZones.rates.formulaTanaka', { bpm: fmtInt(tanakaMax) })} selected={draft.maxHr === tanakaMax} onPress={() => setMaxHr(tanakaMax)} />
        </View>
        {!hasProfile ? (
          <Notice icon="person-outline" action={{ label: t('hrZones.rates.openProfile'), onPress: () => router.push('/settings/profile') }}>
            {t('hrZones.rates.noProfile', { age: fmtInt(age) })}
          </Notice>
        ) : null}
        {draft.method === 'hrr' || (draft.method === 'lthr' && draft.lthr === null) ? (
          <>
            <Divider />
            <StepperRow title={t('hrZones.rates.rest')} caption={draft.restingHr === null ? t('hrZones.rates.restDefault') : t('hrZones.rates.restSet')}>
              <BpmStepper
                label={t('hrZones.rates.rest')}
                lessLabel={t('hrZones.less')}
                moreLabel={t('hrZones.more')}
                value={zones.restingHr}
                min={REST_HR_MIN}
                max={restMax}
                onChange={setRestingHr}
              />
            </StepperRow>
          </>
        ) : null}
        <Details>{t('hrZones.rates.details', { max: fmtInt(MAX_HR_MAX), restMin: fmtInt(REST_HR_MIN), restMax: fmtInt(REST_HR_MAX), gap: fmtInt(REST_HR_GAP) })}</Details>
      </Section>

      {draft.method === 'lthr' && zones.lthr !== null ? (
        <Section title={t('hrZones.lthr.title')} icon="speedometer" tint="heart">
          <StepperRow title={t('hrZones.lthr.label')} caption={draft.lthr === null ? t('hrZones.lthr.estimate') : t('hrZones.lthr.set')}>
            <BpmStepper
              label={t('hrZones.lthr.label')}
              lessLabel={t('hrZones.less')}
              moreLabel={t('hrZones.more')}
              value={zones.lthr}
              min={LTHR_MIN}
              max={zones.maxHr - 1}
              onChange={setLthr}
            />
          </StepperRow>
          <View style={styles.chips}>
            {measured.test ? <Chip label={t('hrZones.lthr.fromTest', { bpm: fmtInt(measured.test.lthr) })} selected={draft.lthr === measured.test.lthr} onPress={() => setLthr(measured.test!.lthr)} /> : null}
            {measured.watch ? <Chip label={t('hrZones.lthr.fromWatch', { bpm: fmtInt(measured.watch.lthr) })} selected={draft.lthr === measured.watch.lthr} onPress={() => setLthr(measured.watch!.lthr)} /> : null}
            <Chip label={t('hrZones.lthr.estimateChip', { bpm: fmtInt(estimateLthr(zones.maxHr, zones.restingHr)) })} selected={draft.lthr === null} onPress={() => setLthr(null)} />
          </View>
          <Button label={t('hrZones.lthr.runTest')} variant="secondary" icon="speedometer" onPress={() => router.push('/lactate-test')} />
          <Details>{t('hrZones.lthr.details')}</Details>
        </Section>
      ) : null}

      <Section title={t('hrZones.zones.title')} icon="stats-chart">
        <AppText variant="caption" muted>
          {t('hrZones.zones.body')}
        </AppText>
        {zones.bounds.map((_, z) => {
          const range = zoneRange(z + 1, zones);
          const offset = zones.bounds.length - HR_ZONE_COUNT;
          const i = z - offset;
          const last = z === zones.bounds.length - 1;
          const names = ZONE_NAME_KEYS[zones.method];
          return (
            <StepperRow
              key={z}
              color={hrZoneColor(palette, z + 1)}
              title={t('hrZones.zones.zone', { n: z + 1, name: t(`hrZones.zones.names.${names[z]}`) })}
              caption={last ? t('hrZones.zones.top', { from: fmtInt(range.from), to: fmtInt(range.to) }) : t('hrZones.zones.range', { from: fmtInt(range.from), to: fmtInt(range.to) })}>
              {i < 0 ? (
                <AppText variant="caption" muted>
                  {t('hrZones.zones.warmupFixed')}
                </AppText>
              ) : (
                <BpmStepper
                  label={t('hrZones.zones.startLabel', { n: z + 1 })}
                  lessLabel={t('hrZones.less')}
                  moreLabel={t('hrZones.more')}
                  value={zones.limits[i] ?? 0}
                  min={i === 0 ? 30 : (zones.limits[i - 1] ?? 0) + 1}
                  max={i === HR_ZONE_COUNT - 1 ? zones.maxHr - 1 : (zones.limits[i + 1] ?? zones.maxHr) - 1}
                  onChange={(value) => setLimit(i, value)}
                />
              )}
            </StepperRow>
          );
        })}
        {zones.custom ? (
          <Notice icon="create-outline" action={{ label: t('hrZones.zones.resetLimits'), onPress: () => edit({ limits: null }) }}>
            {t('hrZones.zones.custom')}
          </Notice>
        ) : null}
        <Details>{t('hrZones.zones.details')}</Details>
      </Section>

      {withWatch ? (
        <Section title={t('hrZones.alert.title')} icon="alert-circle">
          <SwitchRow label={t('hrZones.alert.switch')} hint={t('hrZones.alert.hint')} value={draft.warningEnabled} onValueChange={(warningEnabled) => edit({ warningEnabled })} />
          {draft.warningEnabled ? (
            <StepperRow title={t('hrZones.alert.limit')} caption={draft.warningLimit === null ? t('hrZones.alert.limitMax') : undefined}>
              <BpmStepper
                label={t('hrZones.alert.limit')}
                lessLabel={t('hrZones.less')}
                moreLabel={t('hrZones.more')}
                value={zones.warningLimit}
                min={WARNING_MIN}
                max={MAX_HR_MAX}
                onChange={(warningLimit) => edit({ warningLimit })}
              />
            </StepperRow>
          ) : null}
        </Section>
      ) : null}

      <Section title={t('hrZones.suggest.title')} icon="analytics">
        <AppText variant="caption" muted>
          {t('hrZones.suggest.body')}
        </AppText>
        <Button
          label={t('hrZones.suggest.action')}
          variant="secondary"
          icon="calculator-outline"
          loading={suggestion.status === 'loading'}
          onPress={() => void calculate()}
        />
        {suggestion.status === 'failed' ? <Notice tone="danger">{t('hrZones.suggest.failed')}</Notice> : null}
        {found ? (
          <>
            {found.peak === null && found.restingHr === null ? <Notice>{t('hrZones.suggest.nothing')}</Notice> : null}
            {found.peak !== null ? (
              <StepperRow
                title={t('hrZones.suggest.peak', { bpm: fmtInt(found.peak) })}
                caption={found.maxHr === null ? t('hrZones.suggest.peakBelow', { bpm: fmtInt(formulaMax) }) : t('hrZones.suggest.peakAbove', { bpm: fmtInt(formulaMax) })}>
                {found.maxHr !== null ? (
                  <Button label={t('hrZones.suggest.useMax')} variant="primary" onPress={() => setMaxHr(found.maxHr)} />
                ) : null}
              </StepperRow>
            ) : null}
            {found.restingHr !== null ? (
              <StepperRow title={t('hrZones.suggest.rest', { bpm: fmtInt(found.restingHr) })} caption={t('hrZones.suggest.restBody')}>
                <Button label={t('hrZones.suggest.useRest')} variant="primary" onPress={() => setRestingHr(clampRest(found.restingHr ?? 0, zones.maxHr))} />
              </StepperRow>
            ) : null}
          </>
        ) : null}
      </Section>

      {note ? <Notice icon="watch-outline">{note}</Notice> : null}
      {toast}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 56 },
  stepperText: { flex: 1, gap: 2 },
  swatch: { width: 10, height: 10, borderRadius: 5 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.md },
});

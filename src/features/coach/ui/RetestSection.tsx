import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Vibration, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Metric } from '@/components/Metric';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useHrZones } from '@/features/hrzones/settings';
import { zoneRange } from '@/features/hrzones/zones';
import { holdScreenOn, releaseScreen } from '@/features/strength/keepAwake';
import { formatPace } from '@/features/workouts/analysis/types';
import { formatElapsed } from '@/features/workouts/summary';
import { fmtDate, fmtInt, useLocale } from '@/i18n';
import { useNow } from '@/hooks/useNow';
import { useLiveWorkout } from '@/state/LiveWorkoutProvider';
import { spacing } from '@/theme';
import type { PlannedSession } from '../plans/types';
import { RETEST_DISTANCE_M } from '../plans/runWalk';
import { bandStatus, liveHr } from '../runwalk/hrCue';
import { finishRetest, retestHistory, type RetestResult } from '../runwalk/retest';
import { getGuide, loadRetests, markTestEnd, markTestStart, saveRetest, startRetestGuide, stopGuide, type ActiveGuide } from '../runwalk/store';
import { VIBRATION } from '../runwalk/timeline';

const KEEP_AWAKE_TAG = 'coach-guide';
const TICK_MS = 1000;
const IDLE_TICK_MS = 3_600_000;
const TEST_ZONE = 3;

const buzz = (pattern: readonly number[]): void => {
  try {
    Vibration.vibrate([...pattern]);
  } catch {
    // no vibrator: the screen still tells
  }
};

/** The re-tests of one plan, oldest first, each against the first one; nothing when there is none yet. */
export function RetestHistory({ planId, results }: { planId: string; results?: readonly RetestResult[] }) {
  const { t } = useTranslation('coach');
  useLocale();
  const [stored] = useState(() => (results ? null : loadRetests()));
  const steps = retestHistory(results ?? stored ?? [], planId);
  if (steps.length === 0) return null;
  return (
    <Section title={t('retest.history.title')} icon="stopwatch" tint="workouts">
      <View style={styles.rows}>
        {steps.map(({ result, deltaSecKm }, i) => {
          const date = fmtDate(Math.floor(result.at / 1000), 'short');
          const pace = formatPace(result.secKm);
          const line = result.avgHr === null ? t('retest.history.rowNoHr', { date, pace }) : t('retest.history.row', { date, pace, hr: fmtInt(result.avgHr) });
          const against =
            i === 0
              ? t('retest.history.baseline')
              : deltaSecKm === null
                ? t('retest.history.notComparable')
                : deltaSecKm === 0
                  ? t('retest.history.same')
                  : t(deltaSecKm < 0 ? 'retest.history.faster' : 'retest.history.slower', { delta: formatElapsed(Math.abs(deltaSecKm)) });
          return (
            <View key={result.sessionKey} style={styles.row}>
              <AppText variant="bodyStrong">{line}</AppText>
              <AppText variant="caption" muted>
                {against}
              </AppText>
              {result.measured === 'tap' ? (
                <AppText variant="caption" muted>
                  {t('retest.history.tap')}
                </AppText>
              ) : null}
            </View>
          );
        })}
      </View>
    </Section>
  );
}

/**
 * The guide of the 1 km re-test: a brisk-walk warm-up, then 1 km held at the heart rate of zone 3 (the live rate from the watch says
 * whether you are under, in or over the band), then a walk. The km is timed by the phone and ends when the watch's live distance has grown
 * by 1 km, or when you tap. The pace is saved on the phone and shown against your first test.
 */
export function RetestSection({ session, planId }: { session: PlannedSession; planId: string }) {
  const { t } = useTranslation('coach');
  useLocale();
  const spec = session.run?.retest ?? null;
  const zones = useHrZones();
  const live = useLiveWorkout();
  const [guide, setGuide] = useState<ActiveGuide | null>(() => getGuide(session.key));
  const [cues, setCues] = useState<boolean | null>(null);
  const [results, setResults] = useState<RetestResult[]>(() => loadRetests());
  const now = useNow(guide ? TICK_MS : IDLE_TICK_MS);
  const band = zoneRange(TEST_ZONE, zones);
  const saved = results.find((r) => r.sessionKey === session.key) ?? null;

  const hr = guide ? liveHr(live, now) : null;
  const hrSum = useRef(0);
  const hrCount = useRef(0);
  const testing = guide !== null && guide.testStartedAt !== null && guide.testEndedAt === null;
  const gain = testing && live?.distanceM != null && guide.testStartDistanceM !== null ? live.distanceM - guide.testStartDistanceM : null;

  const finished = useRef(false);
  const finish = (at: number, from: ActiveGuide, distanceM: number | null) => {
    if (finished.current || from.testStartedAt === null || spec === null) return;
    finished.current = true;
    const result = finishRetest(
      { startedAt: from.testStartedAt, endedAt: at, distanceM, hrSum: hrSum.current, hrCount: hrCount.current },
      { planId, sessionKey: session.key, fromBpm: band.from, toBpm: band.to },
    );
    setResults(saveRetest(result));
    buzz(VIBRATION.done);
    void markTestEnd(from, at, spec.cooldownMin * 60).then(setGuide);
  };

  // While the 1 km runs: collect the live heart rate and end the km when the watch's distance says it is covered.
  useEffect(() => {
    if (!testing || !guide) return;
    if (hr !== null) {
      hrSum.current += hr;
      hrCount.current += 1;
    }
    if (gain !== null && gain >= RETEST_DISTANCE_M) finish(now, guide, gain);
    // One look per tick, with that tick's own readings.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const active = guide !== null && guide.testEndedAt === null;
  useEffect(() => {
    if (!active) return;
    void holdScreenOn(KEEP_AWAKE_TAG);
    return () => void releaseScreen(KEEP_AWAKE_TAG);
  }, [active]);

  const warmupEnd = guide && spec ? guide.startedAt + spec.warmupMin * 60_000 : null;
  const cooldownEnd = guide?.testEndedAt != null && spec ? guide.testEndedAt + spec.cooldownMin * 60_000 : null;
  const phase = guide === null ? 'idle' : cooldownEnd !== null ? (now >= cooldownEnd ? 'done' : 'cooldown') : testing ? 'test' : warmupEnd !== null && now >= warmupEnd ? 'ready' : 'warmup';

  const startWarmup = async () => {
    if (!spec) return;
    const startedAt = Date.now();
    setGuide({ key: session.key, startedAt, cues: 0, testStartedAt: null, testEndedAt: null, testStartDistanceM: null });
    setCues(await startRetestGuide(session.key, spec.warmupMin * 60, startedAt));
    setGuide(getGuide(session.key, startedAt));
  };
  const startKm = async () => {
    if (!guide) return;
    hrSum.current = 0;
    hrCount.current = 0;
    finished.current = false;
    buzz(VIBRATION.jog);
    setGuide(await markTestStart(guide, Date.now(), live?.distanceM ?? null));
  };
  const close = () => {
    void stopGuide(guide);
    setGuide(null);
    setCues(null);
  };

  if (spec === null) return null;

  const status = hr === null ? null : bandStatus(hr, band.from, band.to);
  const secondsLeft = phase === 'warmup' && warmupEnd !== null ? (warmupEnd - now) / 1000 : phase === 'cooldown' && cooldownEnd !== null ? (cooldownEnd - now) / 1000 : 0;
  const testSec = testing && guide?.testStartedAt != null ? (now - guide.testStartedAt) / 1000 : 0;

  return (
    <>
      <Section title={t('retest.title')} icon="stopwatch" tint="workouts">
        <AppText variant="body">{t('retest.target', { from: fmtInt(band.from), to: fmtInt(band.to), zone: fmtInt(TEST_ZONE) })}</AppText>
        {phase === 'idle' ? (
          <>
            <AppText variant="caption" muted>
              {t('retest.hint')}
            </AppText>
            {saved ? (
              <AppText variant="caption" muted>
                {t('retest.savedThis', { pace: formatPace(saved.secKm) })}
              </AppText>
            ) : null}
            <Button label={t('retest.start')} variant="primary" icon="play" onPress={() => void startWarmup()} />
          </>
        ) : (
          <>
            {cues === false ? <Notice icon="notifications-off">{t('guide.noCues')}</Notice> : null}
            <View style={styles.clock}>
              <AppText variant="bodyStrong">{t(`retest.phase.${phase}`)}</AppText>
              {phase === 'warmup' || phase === 'cooldown' ? <Metric value={formatElapsed(secondsLeft)} size="hero" /> : null}
              {phase === 'test' ? <Metric value={formatElapsed(testSec)} size="hero" /> : null}
              {phase === 'test' && gain !== null ? (
                <AppText variant="caption" muted>
                  {t('retest.progress', { meters: fmtInt(Math.min(RETEST_DISTANCE_M, Math.max(0, Math.round(gain)))) })}
                </AppText>
              ) : null}
            </View>
            {phase === 'test' && status !== null && hr !== null ? (
              <Notice icon="heart">{t('retest.statusLine', { bpm: fmtInt(hr), status: t(`retest.status.${status}`) })}</Notice>
            ) : phase === 'test' ? (
              <AppText variant="caption" muted>
                {t('guide.hr.none')}
              </AppText>
            ) : null}
            {phase === 'warmup' || phase === 'ready' ? <Button label={t('retest.startKm')} variant="primary" icon="flag" onPress={() => void startKm()} /> : null}
            {phase === 'test' && guide ? <Button label={t('retest.finishKm')} variant="primary" icon="checkmark" onPress={() => finish(Date.now(), guide, gain)} /> : null}
            {phase === 'done' || phase === 'cooldown' ? (
              <Button label={phase === 'done' ? t('guide.close') : t('guide.stop')} variant={phase === 'done' ? 'primary' : 'secondary'} icon={phase === 'done' ? 'checkmark' : 'stop'} onPress={close} />
            ) : (
              <Button label={t('guide.stop')} variant="secondary" icon="stop" onPress={close} />
            )}
          </>
        )}
      </Section>
      <RetestHistory planId={planId} results={results} />
    </>
  );
}

const styles = StyleSheet.create({
  clock: { gap: spacing.xs },
  rows: { gap: spacing.md },
  row: { gap: 2 },
});

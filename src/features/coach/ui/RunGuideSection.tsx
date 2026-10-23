import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Vibration, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Metric } from '@/components/Metric';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useHrZones } from '@/features/hrzones/settings';
import { zoneIndex } from '@/features/hrzones/zones';
import { holdScreenOn, releaseScreen } from '@/features/strength/keepAwake';
import { formatElapsed } from '@/features/workouts/summary';
import { fmtInt, useLocale } from '@/i18n';
import { useNow } from '@/hooks/useNow';
import { useLiveWorkout } from '@/state/LiveWorkoutProvider';
import { spacing } from '@/theme';
import { spanText } from '../format';
import type { PlannedSession } from '../plans/types';
import { FRESH_HR_STATE, liveHr, nextHrCue, type HrCue } from '../runwalk/hrCue';
import { getGuide, notifyNow, startRunGuide, stopGuide, type ActiveGuide } from '../runwalk/store';
import { positionAt, runSegments, VIBRATION, type Segment, type SegmentKind } from '../runwalk/timeline';

const KEEP_AWAKE_TAG = 'coach-guide';
const TICK_MS = 1000;
const IDLE_TICK_MS = 3_600_000;

const buzz = (pattern: readonly number[]): void => {
  try {
    Vibration.vibrate([...pattern]);
  } catch {
    // no vibrator: the screen still tells
  }
};

/**
 * The guide of a Lari-jalan walk/run or jog session: a clock through the session's jog and walk parts that buzzes at every change
 * (and notifies, while the screen is off), and, while the watch sends a live heart rate, tells you to walk when it reaches zone 4
 * and to jog again once it is back in zone 2. The workout itself is recorded by the watch; this only guides.
 */
export function RunGuideSection({ session }: { session: PlannedSession }) {
  const { t } = useTranslation('coach');
  useLocale();
  const run = session.run;
  const segments = useMemo<Segment[]>(() => runSegments(run), [run]);
  const walkAtZone = run?.walkAtZone ?? null;
  const zones = useHrZones();
  const live = useLiveWorkout();
  const [guide, setGuide] = useState<ActiveGuide | null>(() => getGuide(session.key));
  const [cues, setCues] = useState<boolean | null>(null);
  const [advice, setAdvice] = useState<HrCue | null>(null);
  const now = useNow(guide ? TICK_MS : IDLE_TICK_MS);
  const position = guide ? positionAt(segments, guide.startedAt, now) : null;
  const running = position !== null && !position.done;

  // The wrist buzzes when the segment changes; opening the screen mid-session does not buzz for the segment already running.
  const lastIndex = useRef<number | null>(null);
  const index = position?.index ?? null;
  const done = position?.done ?? false;
  const kind: SegmentKind | null = position?.segment?.kind ?? null;
  useEffect(() => {
    if (index === null) {
      lastIndex.current = null;
      return;
    }
    if (lastIndex.current !== null && lastIndex.current !== index && kind !== null && kind !== 'warmup') buzz(VIBRATION[kind]);
    lastIndex.current = index;
  }, [index, kind]);
  useEffect(() => {
    if (done) buzz(VIBRATION.done);
  }, [done]);

  useEffect(() => {
    if (!running) return;
    void holdScreenOn(KEEP_AWAKE_TAG);
    return () => void releaseScreen(KEEP_AWAKE_TAG);
  }, [running]);

  // The heart-rate cue: looked at once a second, from the live workout the watch sends. The interval reads the latest zones and live
  // reading through a ref, so it keeps one cue state for the whole session instead of restarting on every reading.
  const latest = useRef({ live, zones });
  useEffect(() => {
    latest.current = { live, zones };
  });
  const hr = running ? liveHr(live, now) : null;
  const startedAt = guide?.startedAt ?? null;
  useEffect(() => {
    if (!running || walkAtZone === null || startedAt === null) return;
    let state = FRESH_HR_STATE;
    const id = setInterval(() => {
      const nowMs = Date.now();
      const at = positionAt(segments, startedAt, nowMs);
      const step = nextHrCue(state, {
        hr: liveHr(latest.current.live, nowMs),
        nowMs,
        zones: latest.current.zones,
        walkAtZone,
        segmentKind: at.segment?.kind ?? null,
        segmentIndex: at.index,
      });
      state = step.state;
      if (step.cue === null) {
        if (at.segment?.kind !== 'jog') setAdvice(null);
        return;
      }
      setAdvice(step.cue);
      buzz(step.cue === 'walk' ? VIBRATION.hrWalk : VIBRATION.hrResume);
      void notifyNow(t(`guide.hr.${step.cue}.title`), t(`guide.hr.${step.cue}.body`, { zone: fmtInt(walkAtZone) }));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running, walkAtZone, startedAt, segments, t]);

  const start = async () => {
    setAdvice(null);
    const begun = Date.now();
    setGuide({ key: session.key, startedAt: begun, cues: 0, testStartedAt: null, testEndedAt: null, testStartDistanceM: null });
    setCues(await startRunGuide(session.key, segments, begun));
    setGuide(getGuide(session.key, begun));
  };
  const stop = () => {
    void stopGuide(guide);
    setGuide(null);
    setAdvice(null);
    setCues(null);
  };

  if (segments.length === 0 || walkAtZone === null) return null;

  const zone = hr === null ? null : zoneIndex(hr, zones);
  const next = position?.next ?? null;

  return (
    <Section title={t('guide.title')} icon="timer" tint="workouts">
      {guide === null || position === null ? (
        <>
          <AppText variant="body">{t('guide.hint')}</AppText>
          <Button label={t('guide.start')} variant="primary" icon="play" onPress={() => void start()} />
        </>
      ) : (
        <>
          {cues === false ? <Notice icon="notifications-off">{t('guide.noCues')}</Notice> : null}
          <View style={styles.clock}>
            <AppText variant="bodyStrong">{t(`guide.phase.${position.done ? 'done' : (kind ?? 'done')}`)}</AppText>
            {position.done ? null : <Metric value={formatElapsed(position.leftSec)} size="hero" />}
            {next ? (
              <AppText variant="caption" muted>
                {t('guide.next', { phase: t(`guide.phase.${next.kind}`), time: spanText(next.lengthSec) })}
              </AppText>
            ) : null}
            <AppText variant="caption" muted>
              {t('guide.elapsed', { elapsed: formatElapsed(position.elapsedSec), total: formatElapsed(position.totalSec) })}
            </AppText>
          </View>
          {advice ? <Notice icon="heart">{t(`guide.hr.${advice}.line`, { zone: fmtInt(walkAtZone) })}</Notice> : null}
          <AppText variant="caption" muted>
            {hr !== null && zone !== null ? t('guide.hr.value', { bpm: fmtInt(hr), zone: fmtInt(zone) }) : t('guide.hr.none')}
          </AppText>
          <Button label={position.done ? t('guide.close') : t('guide.stop')} variant={position.done ? 'primary' : 'secondary'} icon={position.done ? 'checkmark' : 'stop'} onPress={stop} />
        </>
      )}
    </Section>
  );
}

const styles = StyleSheet.create({
  clock: { gap: spacing.xs },
});

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Field } from '@/components/Input';
import { isIos } from '@/components/IosUnavailable';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useHuaweiImport } from '@/features/settings/useHuaweiImport';
import { formatCount, formatDateTime } from '@/format';
import { radius, spacing, useColors } from '@/theme';
import type { HuaweiImportSummary } from '@/wear';

const REQUEST_URL_SEA = 'https://privacy-sg.consumer.huawei.com/privacycenter';
const REQUEST_HOST_OTHER = 'privacy.consumer.huawei.com';
const HEALTH_APP = isIos ? 'Apple Health' : 'Health Connect';

/**
 * One-time import of the history Huawei Health holds in your Huawei account: you ask Huawei for your data, pick the
 * ZIP it sends and the import reads it on the phone. Free. Nothing is uploaded, and the imported days stay on the
 * phone: they are not sent to the cloud, Apple Health / Health Connect or Strava.
 */
export function HuaweiImportSection() {
  const { t } = useTranslation(['settings', 'common']);
  const { file, password, setPassword, running, progress, summary, error, pick, select, start, cancel } = useHuaweiImport();
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const handled = useRef<string | null>(null);
  // A ZIP opened with or shared to JoyoFit arrives here from `+native-intent` with its address in `uri`.
  useEffect(() => {
    if (!uri || handled.current === uri) return;
    handled.current = uri;
    select(uri);
  }, [uri, select]);
  const ready = file !== null && password.length > 0;

  return (
    <>
      <Section title={t('huaweiImport.requestTitle')} icon="mail" tint="heart">
        <AppText variant="caption" muted>
          {t('huaweiImport.requestIntro')}
        </AppText>
        <Button
          label={t('huaweiImport.requestTitle')}
          variant="secondary"
          icon="open"
          onPress={() => void Linking.openURL(REQUEST_URL_SEA)}
        />
        <Details title={t('huaweiImport.howTitle')}>
        <View style={styles.steps}>
          <Step n={1}>{t('huaweiImport.steps.1')}</Step>
          <Step n={2}>{t('huaweiImport.steps.2')}</Step>
          <Step n={3}>{t('huaweiImport.steps.3')}</Step>
          <Step n={4}>{t('huaweiImport.steps.4')}</Step>
          <Step n={5}>{t('huaweiImport.steps.5')}</Step>
          <Step n={6}>
            {isIos ? t('huaweiImport.steps.6Ios') : t('huaweiImport.steps.6Android')}
          </Step>
        </View>
        <AppText variant="caption" muted>
          {t('huaweiImport.otherRegion', { host: REQUEST_HOST_OTHER })}
        </AppText>
        </Details>
      </Section>

      <Section title={t('huaweiImport.importTitle')} icon="document" tint="heart">
        <Button
          label={file ? t('huaweiImport.chooseAnother') : t('huaweiImport.choose')}
          variant="secondary"
          icon="folder-open"
          onPress={() => void pick()}
          disabled={running}
        />
        {file ? <KeyValue icon="document" label={t('huaweiImport.file')} value={file.name} /> : null}
        <Field
          label={t('huaweiImport.password')}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
          editable={!running}
        />
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <Notice icon="information-circle">{t('huaweiImport.keepOpen')}</Notice>
        {running ? (
          <>
            <ProgressBar fraction={progress?.fraction ?? 0} />
            <AppText variant="caption" muted>
              {progress && progress.fileCount > 0
                ? progress.fileName
                  ? t('huaweiImport.fileProgressNamed', { index: progress.fileIndex, count: progress.fileCount, name: progress.fileName })
                  : t('huaweiImport.fileProgress', { index: progress.fileIndex, count: progress.fileCount })
                : t('huaweiImport.opening')}
            </AppText>
            {progress ? <Counts summary={progress.summary} /> : null}
            <Button label={t('common:actions.cancel')} variant="secondary" icon="close" onPress={cancel} />
          </>
        ) : (
          <Button label={t('huaweiImport.import')} variant="primary" icon="cloud-download" onPress={() => void start()} disabled={!ready} />
        )}
        <Details>{t('huaweiImport.details', { app: HEALTH_APP })}</Details>
      </Section>

      {summary ? <Summary summary={summary} /> : null}
    </>
  );
}

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <View style={styles.step}>
      <AppText variant="label" style={styles.stepNumber}>
        {n}
      </AppText>
      <AppText variant="caption" style={styles.stepText}>
        {children}
      </AppText>
    </View>
  );
}

function Pair({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.pair}>
      <AppText variant="caption" muted numberOfLines={2}>
        {label}
      </AppText>
      <AppText variant="bodyStrong" style={styles.pairValue}>
        {value}
      </AppText>
    </View>
  );
}

function ProgressBar({ fraction }: { fraction: number }) {
  const colors = useColors();
  const percent = Math.round(Math.min(1, Math.max(0, fraction)) * 100);
  return (
    <View
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: percent }}
      style={[styles.track, { backgroundColor: colors.muted }]}>
      <View style={[styles.fill, { backgroundColor: colors.primary, width: `${percent}%` }]} />
    </View>
  );
}

/** The counts that move while the import runs. */
function Counts({ summary }: { summary: HuaweiImportSummary }) {
  const { t } = useTranslation('settings');
  return (
    <>
      <View style={styles.grid}>
        <Pair label={t('huaweiImport.workoutsAdded')} value={formatCount(summary.workoutsAdded)} />
        <Pair label={t('huaweiImport.heartRate')} value={formatCount(summary.heartRateReadings)} />
        <Pair label={t('huaweiImport.sleepFound')} value={formatCount(summary.sleepSegmentsFound)} />
      </View>
    </>
  );
}

function Summary({ summary }: { summary: HuaweiImportSummary }) {
  const { t } = useTranslation('settings');
  const range =
    summary.oldestSec !== null && summary.newestSec !== null
      ? t('huaweiImport.range', { from: formatDateTime(summary.oldestSec), to: formatDateTime(summary.newestSec) })
      : null;
  const skippedWorkouts = summary.workoutsFound - summary.workoutsAdded;
  const skippedSleep = summary.sleepSegmentsFound - summary.sleepSegmentsAdded;
  return (
    <Section title={summary.cancelled ? t('huaweiImport.stopped') : t('huaweiImport.finished')} icon="checkmark-circle" tint="heart">
      {summary.cancelled ? (
        <Notice icon="information-circle">
          {t('huaweiImport.stoppedNotice')}
        </Notice>
      ) : null}
      <KeyValue icon="calendar" label={t('huaweiImport.historyRead')} value={range} />
      <View style={styles.grid}>
        <Pair label={t('huaweiImport.workoutsAdded')} value={formatCount(summary.workoutsAdded)} />
        <Pair label={t('huaweiImport.sleepAdded')} value={formatCount(summary.sleepSegmentsAdded)} />
        <Pair label={t('huaweiImport.heartRate')} value={formatCount(summary.heartRateReadings)} />
        <Pair label={t('huaweiImport.restingHr')} value={formatCount(summary.restingHeartRateReadings)} />
        <Pair label={t('huaweiImport.spo2')} value={formatCount(summary.spo2Readings)} />
        <Pair label={t('huaweiImport.stressAdded')} value={formatCount(summary.stressAdded)} />
        {summary.weighInsFound ? <Pair label={t('huaweiImport.weighIns')} value={formatCount(summary.weighInsAdded ?? 0)} /> : null}
        {summary.sleepScoresFound ? <Pair label={t('huaweiImport.sleepScores')} value={formatCount(summary.sleepScoresAdded ?? 0)} /> : null}
        {summary.metricsFound ? <Pair label={t('huaweiImport.metrics')} value={formatCount(summary.metricsAdded ?? 0)} /> : null}
        {summary.dayTotalsFound ? <Pair label={t('huaweiImport.dayTotals')} value={formatCount(summary.dayTotalsAdded ?? 0)} /> : null}
        {summary.workoutsUpdated ? <Pair label={t('huaweiImport.workoutsUpdated')} value={formatCount(summary.workoutsUpdated)} /> : null}
        <Pair label={t('huaweiImport.minutes')} value={formatCount(summary.minutesWritten)} />
        {skippedWorkouts > 0 ? <Pair label={t('huaweiImport.alreadyHere')} value={formatCount(skippedWorkouts)} /> : null}
        {skippedSleep > 0 ? <Pair label={t('huaweiImport.sleepSkipped')} value={formatCount(skippedSleep)} /> : null}
        {summary.badRecords + summary.rejectedSamples > 0 ? (
          <Pair label={t('huaweiImport.unreadable')} value={formatCount(summary.badRecords + summary.rejectedSamples)} />
        ) : null}
      </View>
      {summary.filesFailed > 0 ? (
        <Notice tone="danger">
          {t('huaweiImport.filesFailed', { count: summary.filesFailed })}
        </Notice>
      ) : null}
      <Breakdown summary={summary} />
      <Details>{t('huaweiImport.summaryDetails')}</Details>
    </Section>
  );
}

/** Why readings were skipped and which kinds the file has that JoyoFit does not store: what a user needs to report a gap. */
function Breakdown({ summary }: { summary: HuaweiImportSummary }) {
  const { t } = useTranslation('settings');
  const rejected = summary.rejectedReasons ?? [];
  const bad = summary.badRecordReasons ?? [];
  const leftOut = summary.unmappedKeys ?? [];
  if (rejected.length + bad.length + leftOut.length === 0) return null;
  return (
    <Details title={t('huaweiImport.unreadableTitle')}>
      <View style={styles.steps}>
        {rejected.map((r) => (
          <AppText key={`${r.key}|${r.reason}`} variant="caption" muted>
            {r.sample
              ? t('huaweiImport.unreadableLine', { key: r.key, reason: t(`huaweiImport.reasons.${r.reason}`, { defaultValue: r.reason }), count: r.count, sample: r.sample })
              : t('huaweiImport.unreadableLineNoSample', { key: r.key, reason: t(`huaweiImport.reasons.${r.reason}`, { defaultValue: r.reason }), count: r.count })}
          </AppText>
        ))}
        {bad.map((b) => (
          <AppText key={b.reason} variant="caption" muted>
            {t('huaweiImport.badRecordLine', { reason: b.reason, count: b.count })}
          </AppText>
        ))}
        {leftOut.length > 0 ? (
          <AppText variant="label" muted>
            {t('huaweiImport.leftOutTitle')}
          </AppText>
        ) : null}
        {leftOut.map((k) => (
          <AppText key={k.key} variant="caption" muted>
            {t('huaweiImport.leftOutLine', { key: k.key, count: k.count })}
          </AppText>
        ))}
      </View>
    </Details>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, columnGap: spacing.md },
  pair: { width: '47%' },
  pairValue: { fontVariant: ['tabular-nums'] },
  steps: { gap: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  stepNumber: { width: 18, textAlign: 'center' },
  stepText: { flex: 1 },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
});

import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { useAppleHealthImport } from '@/features/settings/useAppleHealthImport';
import { formatCount, formatDateTime } from '@/format';
import { radius, useColors } from '@/theme';
import type { HuaweiImportSummary } from '@/wear';

/**
 * One-time import of the history Huawei Health saved into Apple Health (iOS). JoyoFit reads Apple Health only here, only
 * after you tap the button, and nothing leaves the phone. Samples JoyoFit wrote itself are skipped. Imported days stay on
 * the phone: they are not uploaded, written back to Apple Health or sent to Strava.
 */
export function AppleHealthImportSection() {
  const { running, progress, summary, error, start, cancel } = useAppleHealthImport();

  return (
    <>
      <Section title="Import history from Apple Health" icon="heart" tint="heart">
        <AppText variant="caption" muted>
          Huawei Health on iPhone saves your steps, heart rate, sleep, blood oxygen and workouts in Apple Health. Bring that
          history into JoyoFit once. JoyoFit asks for permission to read Apple Health when you tap the button below, reads
          it on this phone and sends nothing anywhere.
        </AppText>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        {running ? (
          <>
            <ProgressBar fraction={progress?.fraction ?? 0} />
            <AppText variant="caption" muted>
              {progress ? `Reading Apple Health: ${Math.round(progress.fraction * 100)}%` : 'Waiting for permission'}
            </AppText>
            {progress ? <Counts summary={progress.summary} /> : null}
            <Button label="Cancel" variant="secondary" icon="close" onPress={cancel} />
          </>
        ) : (
          <Button label="Import history from Apple Health" variant="primary" icon="heart" onPress={() => void start()} />
        )}
        <AppText variant="caption" muted>
          Data your watch already stored in JoyoFit is never replaced, and importing again adds nothing new. Data JoyoFit
          itself saved to Apple Health is skipped. Imported days stay on this phone: they are not uploaded to the cloud,
          written back to Apple Health or sent to Strava.
        </AppText>
      </Section>

      {summary ? <Summary summary={summary} /> : null}
    </>
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

function Counts({ summary }: { summary: HuaweiImportSummary }) {
  return (
    <>
      <KeyValue label="Workouts added" value={formatCount(summary.workoutsAdded)} />
      <KeyValue label="Heart rate readings" value={formatCount(summary.heartRateReadings)} />
      <KeyValue label="Sleep stages found" value={formatCount(summary.sleepSegmentsFound)} />
    </>
  );
}

function Summary({ summary }: { summary: HuaweiImportSummary }) {
  const range =
    summary.oldestSec !== null && summary.newestSec !== null
      ? `${formatDateTime(summary.oldestSec)} to ${formatDateTime(summary.newestSec)}`
      : null;
  const empty = summary.oldestSec === null;
  const skippedWorkouts = summary.workoutsFound - summary.workoutsAdded;
  const skippedSleep = summary.sleepSegmentsFound - summary.sleepSegmentsAdded;
  return (
    <Section title={summary.cancelled ? 'Import stopped' : 'Import finished'} icon="checkmark-circle" tint="heart">
      {summary.cancelled ? (
        <Notice icon="information-circle">
          You stopped the import. What was read so far is saved; import again to continue.
        </Notice>
      ) : null}
      {empty && !summary.cancelled ? (
        <Notice icon="information-circle">
          Nothing was found. Check that JoyoFit may read Apple Health (Health, your profile picture, Apps, JoyoFit) and that
          Huawei Health saves to Apple Health.
        </Notice>
      ) : null}
      <KeyValue icon="calendar" label="History read" value={range} />
      <KeyValue icon="barbell" label="Workouts added" value={formatCount(summary.workoutsAdded)} />
      <KeyValue icon="moon" label="Sleep stages added" value={formatCount(summary.sleepSegmentsAdded)} />
      <KeyValue icon="heart" label="Heart rate readings" value={formatCount(summary.heartRateReadings)} />
      <KeyValue label="Resting heart rate readings" value={formatCount(summary.restingHeartRateReadings)} />
      <KeyValue label="Blood oxygen readings" value={formatCount(summary.spo2Readings)} />
      <KeyValue icon="footsteps" label="Minutes with data written" value={formatCount(summary.minutesWritten)} />
      {skippedWorkouts > 0 ? (
        <KeyValue label="Workouts already on the phone" value={formatCount(skippedWorkouts)} />
      ) : null}
      {skippedSleep > 0 ? (
        <KeyValue label="Sleep stages skipped (watch data kept)" value={formatCount(skippedSleep)} />
      ) : null}
      {summary.rejectedSamples > 0 ? (
        <KeyValue label="Implausible readings skipped" value={formatCount(summary.rejectedSamples)} />
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
});

import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, type ReactNode } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
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
      <Section title="Import from Huawei Health" icon="cloud-download" tint="heart">
        <AppText variant="caption" muted>
          Bring the heart rate, sleep, steps and workouts from your Huawei Health account into JoyoFit. It is free, runs
          on this phone and sends nothing anywhere.
        </AppText>
      </Section>

      <Section title="Request your data from Huawei" icon="mail" tint="heart">
        <View style={styles.steps}>
          <Step n={1}>Tap the button below and sign in with your Huawei ID.</Step>
          <Step n={2}>Choose Request your data and tick Health data.</Step>
          <Step n={3}>
            Set a password for the ZIP and remember it: Huawei cannot show it again and the file does not open without it.
          </Step>
          <Step n={4}>
            Wait for the email from Huawei. This can take up to 7 days, and the link works for 21 days. Large exports come
            as several ZIP parts of up to 5 GB each.
          </Step>
          <Step n={5}>
            Before you unbind the watch from Huawei Health, open Huawei Health and pull down to sync once more. What is
            only on the watch and not yet in your account is lost when you unbind it.
          </Step>
          <Step n={6}>
            {isIos
              ? 'Download the ZIP (on iPhone it ends up in the Files app), then choose it below and enter the password.'
              : 'Download the ZIP, then tap it in your email or Files app and choose JoyoFit, or choose it below. Enter the password.'}
          </Step>
        </View>
        <Button
          label="Request your data from Huawei"
          variant="secondary"
          icon="open"
          onPress={() => void Linking.openURL(REQUEST_URL_SEA)}
        />
        <AppText variant="caption" muted>
          An account outside South-East Asia: use {REQUEST_HOST_OTHER} instead. If the page fails for an Indonesian
          account, the link above is the one that works; the in-app Privacy Center does not.
        </AppText>
      </Section>

      <Section title="Import the file" icon="document" tint="heart">
        <Button
          label={file ? 'Choose another file' : 'Choose the ZIP file'}
          variant="secondary"
          icon="folder-open"
          onPress={() => void pick()}
          disabled={running}
        />
        {file ? <KeyValue icon="document" label="File" value={file.name} /> : null}
        <Field
          label="ZIP password"
          hint="The password you set when you requested the data. It is only kept while this screen is open."
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
        {running ? (
          <>
            <ProgressBar fraction={progress?.fraction ?? 0} />
            <AppText variant="caption" muted>
              {progress && progress.fileCount > 0
                ? `File ${progress.fileIndex} of ${progress.fileCount}${progress.fileName ? `: ${progress.fileName}` : ''}`
                : 'Opening the ZIP'}
            </AppText>
            {progress ? <Counts summary={progress.summary} /> : null}
            <Button label="Cancel" variant="secondary" icon="close" onPress={cancel} />
          </>
        ) : (
          <Button label="Import" variant="primary" icon="cloud-download" onPress={() => void start()} disabled={!ready} />
        )}
        <AppText variant="caption" muted>
          Data the watch already stored on this phone is never replaced. Importing the same file twice adds nothing the
          second time. Imported days stay on this phone: they are not uploaded to the cloud, written to {HEALTH_APP}
          or sent to Strava.
        </AppText>
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
  const skippedWorkouts = summary.workoutsFound - summary.workoutsAdded;
  const skippedSleep = summary.sleepSegmentsFound - summary.sleepSegmentsAdded;
  return (
    <Section title={summary.cancelled ? 'Import stopped' : 'Import finished'} icon="checkmark-circle" tint="heart">
      {summary.cancelled ? (
        <Notice icon="information-circle">
          You stopped the import. What was read so far is saved; import the same file again to continue.
        </Notice>
      ) : null}
      <KeyValue icon="calendar" label="History read" value={range} />
      <KeyValue icon="barbell" label="Workouts added" value={formatCount(summary.workoutsAdded)} />
      <KeyValue icon="moon" label="Sleep stages added" value={formatCount(summary.sleepSegmentsAdded)} />
      <KeyValue icon="heart" label="Heart rate readings" value={formatCount(summary.heartRateReadings)} />
      <KeyValue label="Resting heart rate readings" value={formatCount(summary.restingHeartRateReadings)} />
      <KeyValue label="Blood oxygen readings" value={formatCount(summary.spo2Readings)} />
      <KeyValue label="Stress readings added" value={formatCount(summary.stressAdded)} />
      <KeyValue icon="footsteps" label="Minutes with data written" value={formatCount(summary.minutesWritten)} />
      {skippedWorkouts > 0 ? (
        <KeyValue label="Workouts already on the phone" value={formatCount(skippedWorkouts)} />
      ) : null}
      {skippedSleep > 0 ? (
        <KeyValue label="Sleep stages skipped (watch data kept)" value={formatCount(skippedSleep)} />
      ) : null}
      {summary.badRecords + summary.rejectedSamples > 0 ? (
        <KeyValue label="Unreadable records skipped" value={formatCount(summary.badRecords + summary.rejectedSamples)} />
      ) : null}
      {summary.filesFailed > 0 ? (
        <Notice tone="danger">
          {summary.filesFailed === 1 ? 'One file' : `${summary.filesFailed} files`} in the ZIP could not be read. The rest
          was imported; download the export again and import it to fill the gap.
        </Notice>
      ) : null}
      <AppText variant="caption" muted>
        Calories per minute and weight are not imported. Workout calories are.
      </AppText>
    </Section>
  );
}

const styles = StyleSheet.create({
  steps: { gap: spacing.sm },
  step: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  stepNumber: { width: 18, textAlign: 'center' },
  stepText: { flex: 1 },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: 8, borderRadius: radius.pill },
});

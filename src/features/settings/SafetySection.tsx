import { useCallback, useState } from 'react';
import { Linking, PermissionsAndroid } from 'react-native';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatDateTime } from '@/format';
import { HuaweiWear } from '@/wear';

const FALL_LABELS = { '-1': 'Not reported yet', '0': 'Off', '1': 'On' } as const;

/** Fall detection on the watch, the SOS SMS relay and the morning sleep report. */
export function SafetySection() {
  const [safety, setSafety] = useState(() => HuaweiWear.getSafety());
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [test, setTest] = useState<string | null>(null);
  const [sleepNote, setSleepNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => setSafety(HuaweiWear.getSafety()), []);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setTest(null);
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
      refresh();
    }
  };

  const toggleSos = (enabled: boolean) =>
    run(async () => {
      setBlocked(false);
      if (enabled) {
        const permission = PermissionsAndroid.PERMISSIONS.SEND_SMS;
        let granted = await PermissionsAndroid.check(permission);
        if (!granted) {
          const result = await PermissionsAndroid.request(permission, {
            title: 'Send SMS for SOS',
            message:
              'When your watch sends an SOS, JoyoFit sends the text message it asks for, from this phone and your SIM. It never sends anything else.',
            buttonPositive: 'Allow',
            buttonNegative: 'Not now',
          });
          granted = result === PermissionsAndroid.RESULTS.GRANTED;
          setBlocked(result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
        }
        if (!granted) {
          setError('Without the SMS permission JoyoFit cannot send the SOS text. The relay stays off.');
          return;
        }
      }
      await HuaweiWear.setSosRelayEnabled(enabled);
    });

  const checkSos = (
    <Button
      label="Check without sending"
      variant="secondary"
      icon="shield-checkmark"
      disabled={busy}
      onPress={() => {
        setError(null);
        const result = HuaweiWear.testSosRelay();
        setTest(
          result.ready
            ? 'Ready: an SOS from the watch would be sent as a text. Nothing was sent now.'
            : `An SOS from the watch would not be sent: ${result.blockers.join('; ')}. Nothing was sent now.`,
        );
        refresh();
      }}
    />
  );

  const fallState = FALL_LABELS[String(safety.fallSwitch) as keyof typeof FALL_LABELS];

  return (
    <>
      <Section title="Fall detection" icon="body">
        <SwitchRow
          icon="walk"
          label="Detect falls on the watch"
          hint={safety.fallSupported ? undefined : `Not available: ${safety.fallNote}.`}
          value={safety.fallSwitch === 1}
          disabled={!safety.fallSupported || busy}
          onValueChange={(enabled) => run(async () => void (await HuaweiWear.setFallDetection(enabled)))}
        />
        <PairGrid>
          <Pair label="Watch reports" value={fallState} />
          <Pair label="Last changed" value={safety.fallUpdatedMs > 0 ? formatDateTime(safety.fallUpdatedMs / 1000) : null} />
        </PairGrid>
        <Button
          label="Ask the watch"
          variant="secondary"
          icon="refresh"
          disabled={!safety.fallSupported || busy}
          onPress={() => run(async () => void (await HuaweiWear.queryFallDetection()))}
        />
        <Details>
          {safety.smsSupported
            ? 'After a hard fall the watch asks you if you are all right and can start an SOS.'
            : 'After a hard fall the watch asks you if you are all right. This version of JoyoFit cannot send the SOS text.'}
        </Details>
      </Section>

      {safety.smsSupported ? (
        <Section title="SOS text messages" icon="alert-circle" tint="heart">
          <SwitchRow
            icon="chatbubble-ellipses"
            label="Send SOS texts for the watch"
            value={safety.sosRelayEnabled}
            disabled={busy}
            onValueChange={toggleSos}
          />
          <PairGrid>
            <Pair label="Permission to send SMS" value={safety.smsPermission ? 'Granted' : 'Not granted'} />
            <Pair label="SIM card" value={!safety.telephony ? 'No telephony' : safety.simReady ? 'Ready' : 'Not ready'} />
            <Pair label="Watch lists SOS texts" value={safety.sosListedByWatch ? 'Yes' : 'Not in its capability list'} wide />
          </PairGrid>
          {blocked ? (
            <ButtonRow>
              {checkSos}
              <Button label="App settings" variant="secondary" icon="settings-outline" onPress={() => void Linking.openSettings()} />
            </ButtonRow>
          ) : (
            checkSos
          )}
          {test ? <Notice icon={safety.sosReady ? 'checkmark-circle' : 'information-circle'}>{test}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Details>
            When you start an SOS on the watch, the watch hands this phone a number and a message. With the switch on, JoyoFit sends
            that text from your SIM and tells the watch whether it went out. The watch (or its emergency contacts in the Huawei
            settings on it) decides who is texted; JoyoFit never picks a recipient and never sends anything the watch did not ask for.
            Off by default. Needs permission to send SMS and a ready SIM; costs whatever your plan charges per text. If an SOS would
            not be sent, the watch is told it failed.
          </Details>
        </Section>
      ) : isIos ? (
        <Section title="SOS text messages" icon="alert-circle" tint="heart">
          <Notice>Not possible on iOS. Do not rely on the watch to text your contacts.</Notice>
          <Details>
            iOS does not let an app send a text message by itself, so JoyoFit cannot text your contacts when the watch starts an SOS.
            JoyoFit tells the watch that nothing was sent.
          </Details>
        </Section>
      ) : (
        <Section title="SOS text messages" icon="alert-circle" tint="heart">
          <Notice>Not in the Google Play version. Do not rely on the watch to text your contacts.</Notice>
          <Details>
            Google Play restricts apps that send text messages, so this version does not include the feature. An SOS started on the
            watch is not sent as an SMS from this phone: JoyoFit tells the watch that nothing was sent.
          </Details>
        </Section>
      )}

      <Section title="Morning sleep report" icon="moon" tint="sleep">
        <SwitchRow
          icon="notifications"
          label="Show last night's sleep"
          hint={safety.sleepReportSupported ? undefined : 'Not available: the watch does not report the event channel it needs.'}
          value={safety.sleepReportEnabled}
          disabled={!safety.sleepReportSupported || busy}
          onValueChange={(enabled) => run(() => HuaweiWear.setSleepReportEnabled(enabled))}
        />
        <Button
          label="Send report now"
          variant="secondary"
          icon="send"
          disabled={!safety.sleepReportSupported || busy}
          onPress={() =>
            run(async () => {
              const outcome = await HuaweiWear.sendSleepReportNow();
              setSleepNote(outcome === 'sent' ? 'Sent. Check the watch.' : `Not sent: ${outcome}.`);
            })
          }
        />
        {sleepNote ? <Notice>{sleepNote}</Notice> : null}
        <Details>
          Once each morning, after the first sync that holds last night, the watch shows how long you slept and the stages.
        </Details>
      </Section>
    </>
  );
}

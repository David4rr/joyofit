import { useCallback, useEffect, useState } from 'react';
import { Linking, PermissionsAndroid, type Permission } from 'react-native';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { isIos } from '@/components/IosUnavailable';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage } from '@/format';
import { HuaweiWear } from '@/wear';

const { PERMISSIONS, RESULTS } = PermissionsAndroid;

/**
 * Asks for [required] and then for the optional ones in the same dialog sequence. Resolves with
 * whether every required permission is granted and whether Android will no longer show the dialog.
 */
async function ask(required: Permission[], optional: Permission[]) {
  const results = await PermissionsAndroid.requestMultiple([...required, ...optional]);
  const granted = required.every((p) => results[p] === RESULTS.GRANTED);
  const blocked = required.some((p) => results[p] === RESULTS.NEVER_ASK_AGAIN);
  return { granted, blocked };
}

/** Find my phone, incoming calls on the watch and call control from the watch. */
export function PhoneSection() {
  return isIos ? <PhoneSectionIos /> : <PhoneSectionAndroid />;
}

/** What iOS does not allow, said once per feature instead of three switches that cannot work. */
function PhoneSectionIos() {
  return (
    <Section title="Phone and calls" icon="call">
      <Notice icon="locate">Find my phone from the watch: not possible on iOS.</Notice>
      <Notice icon="call">Answering or rejecting calls from the watch: not possible on iOS.</Notice>
      <Details>
        {"Find my phone: iOS suspends JoyoFit when it is not on screen and does not let it ring the phone on request, so the watch button cannot find this iPhone. Use Find My on another Apple device or iCloud.com instead.\n\nCalls: iOS does not let an app see, answer or reject phone calls. If the watch shows incoming calls at all, it does so itself through the notifications iOS shares with it (Notifications settings)."}
      </Details>
    </Section>
  );
}

function PhoneSectionAndroid() {
  const [features, setFeatures] = useState(() => HuaweiWear.getPhoneFeatures());
  const [error, setError] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);

  const [gps, setGps] = useState<boolean | null>(null);
  const checkGps = useCallback(
    () => void PermissionsAndroid.check(PERMISSIONS.ACCESS_FINE_LOCATION).then(setGps),
    [],
  );
  useEffect(checkGps, [checkGps]);

  const refresh = useCallback(() => {
    setFeatures(HuaweiWear.getPhoneFeatures());
    checkGps();
  }, [checkGps]);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      refresh();
    }
  };

  const toggleCalls = (enabled: boolean) =>
    run(async () => {
      setBlocked(false);
      if (enabled) {
        const result = await ask(
          [PERMISSIONS.READ_PHONE_STATE],
          features.callerIdSupported ? [PERMISSIONS.READ_CALL_LOG, PERMISSIONS.READ_CONTACTS] : [],
        );
        if (!result.granted) {
          setBlocked(result.blocked);
          setError('Phone state permission is required to see incoming calls.');
          return;
        }
      }
      await HuaweiWear.setCallsEnabled(enabled);
    });

  const toggleCallControl = (enabled: boolean) =>
    run(async () => {
      setBlocked(false);
      if (enabled) {
        const result = await ask([PERMISSIONS.ANSWER_PHONE_CALLS], []);
        if (!result.granted) {
          setBlocked(result.blocked);
          setError('Permission to answer phone calls is required.');
          return;
        }
      }
      await HuaweiWear.setCallControlEnabled(enabled);
    });

  return (
    <Section title="Phone and calls" icon="call">
      <SwitchRow
        icon="locate"
        label="Find my phone from the watch"
        value={features.findPhoneEnabled}
        onValueChange={(enabled) => run(() => HuaweiWear.setFindPhoneEnabled(enabled))}
      />
      <SwitchRow
        icon="call"
        label="Show incoming calls on the watch"
        value={features.callsEnabled}
        onValueChange={toggleCalls}
      />
      <SwitchRow
        icon="call-outline"
        label="Answer and reject calls from the watch"
        value={features.callControlEnabled}
        onValueChange={toggleCallControl}
      />
      <PairGrid>
        <Pair label="Phone state" value={features.readPhoneState ? 'Granted' : 'Not granted'} />
        <Pair label="Answer phone calls" value={features.answerPhoneCalls ? 'Granted' : 'Not granted'} />
        {features.callerIdSupported ? (
          <>
            <Pair label="Caller number (call log)" value={features.readCallLog ? 'Granted' : 'Not granted'} />
            <Pair label="Contact names" value={features.readContacts ? 'Granted' : 'Not granted'} />
          </>
        ) : null}
        <Pair label="Phone GPS (outdoor workouts)" value={gps === null ? null : gps ? 'Granted' : 'Not granted'} />
      </PairGrid>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {gps === false || blocked ? (
        <ButtonRow>
          {gps === false ? (
            <Button
              label="Allow location"
              variant="secondary"
              icon="location"
              onPress={() =>
                run(async () => {
                  setBlocked(false);
                  const result = await PermissionsAndroid.request(PERMISSIONS.ACCESS_FINE_LOCATION);
                  setBlocked(result === RESULTS.NEVER_ASK_AGAIN);
                })
              }
            />
          ) : null}
          {blocked ? (
            <Button
              label="App settings"
              variant="secondary"
              icon="settings-outline"
              onPress={() => void Linking.openSettings()}
            />
          ) : null}
        </ButtonRow>
      ) : null}
      <Details>
        {(features.callerIdSupported
          ? 'Without call log access Android hides the caller number. Without contacts access you see the number instead of the name.'
          : 'The watch shows that the phone is ringing. This version of JoyoFit does not read your call log or contacts, so it cannot show who is calling.') +
          '\n\nFind my phone: the watch button rings this phone loudly, even with the app closed. Stop it on the watch or from the notification.'}
      </Details>
    </Section>
  );
}

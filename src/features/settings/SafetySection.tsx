import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
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

const FALL_KEYS = { '-1': 'safety.fall.unknown', '0': 'safety.fall.off', '1': 'safety.fall.on' } as const;

/** Fall detection on the watch, the SOS SMS relay and the morning sleep report. */
export function SafetySection() {
  const { t } = useTranslation('settings');
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
            title: t('safety.sms.title'),
            message: t('safety.sms.message'),
            buttonPositive: t('safety.sms.allow'),
            buttonNegative: t('safety.sms.notNow'),
          });
          granted = result === PermissionsAndroid.RESULTS.GRANTED;
          setBlocked(result === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN);
        }
        if (!granted) {
          setError(t('safety.sms.denied'));
          return;
        }
      }
      await HuaweiWear.setSosRelayEnabled(enabled);
    });

  const checkSos = (
    <Button
      label={t('safety.check')}
      variant="secondary"
      icon="shield-checkmark"
      disabled={busy}
      onPress={() => {
        setError(null);
        const result = HuaweiWear.testSosRelay();
        setTest(
          result.ready
            ? t('safety.testReady')
            : t('safety.testBlocked', { blockers: result.blockers.join('; ') }),
        );
        refresh();
      }}
    />
  );

  const fallState = t(FALL_KEYS[String(safety.fallSwitch) as keyof typeof FALL_KEYS]);

  return (
    <>
      <Section title={t('safety.fallTitle')} icon="body">
        <SwitchRow
          icon="walk"
          label={t('safety.detect')}
          hint={safety.fallSupported ? undefined : t('safety.fallUnavailable', { note: safety.fallNote })}
          value={safety.fallSwitch === 1}
          disabled={!safety.fallSupported || busy}
          onValueChange={(enabled) => run(async () => void (await HuaweiWear.setFallDetection(enabled)))}
        />
        <PairGrid>
          <Pair label={t('safety.reports')} value={fallState} />
          <Pair label={t('safety.lastChanged')} value={safety.fallUpdatedMs > 0 ? formatDateTime(safety.fallUpdatedMs / 1000) : null} />
        </PairGrid>
        <Button
          label={t('safety.askWatch')}
          variant="secondary"
          icon="refresh"
          disabled={!safety.fallSupported || busy}
          onPress={() => run(async () => void (await HuaweiWear.queryFallDetection()))}
        />
        <Details>
          {safety.smsSupported ? t('safety.fallDetailsSms') : t('safety.fallDetails')}
        </Details>
      </Section>

      {safety.smsSupported ? (
        <Section title={t('safety.sosTitle')} icon="alert-circle" tint="heart">
          <SwitchRow
            icon="chatbubble-ellipses"
            label={t('safety.sosSwitch')}
            value={safety.sosRelayEnabled}
            disabled={busy}
            onValueChange={toggleSos}
          />
          <PairGrid>
            <Pair label={t('safety.smsPermission')} value={safety.smsPermission ? t('safety.granted') : t('safety.notGranted')} />
            <Pair label={t('safety.sim')}
              value={!safety.telephony ? t('safety.simNone') : safety.simReady ? t('safety.simReady') : t('safety.simNotReady')} />
            <Pair label={t('safety.watchLists')}
              value={safety.sosListedByWatch ? t('safety.yes') : t('safety.notListed')} wide />
          </PairGrid>
          {blocked ? (
            <ButtonRow>
              {checkSos}
              <Button label={t('safety.appSettings')} variant="secondary" icon="settings-outline" onPress={() => void Linking.openSettings()} />
            </ButtonRow>
          ) : (
            checkSos
          )}
          {test ? <Notice icon={safety.sosReady ? 'checkmark-circle' : 'information-circle'}>{test}</Notice> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          <Details>{t('safety.sosDetails')}</Details>
        </Section>
      ) : isIos ? (
        <Section title={t('safety.sosTitle')} icon="alert-circle" tint="heart">
          <Notice>{t('safety.iosNotice')}</Notice>
          <Details>{t('safety.iosDetails')}</Details>
        </Section>
      ) : (
        <Section title={t('safety.sosTitle')} icon="alert-circle" tint="heart">
          <Notice>{t('safety.playNotice')}</Notice>
          <Details>{t('safety.playDetails')}</Details>
        </Section>
      )}

      <Section title={t('safety.sleepTitle')} icon="moon" tint="sleep">
        <SwitchRow
          icon="notifications"
          label={t('safety.sleepShow')}
          hint={safety.sleepReportSupported ? undefined : t('safety.sleepUnavailable')}
          value={safety.sleepReportEnabled}
          disabled={!safety.sleepReportSupported || busy}
          onValueChange={(enabled) => run(() => HuaweiWear.setSleepReportEnabled(enabled))}
        />
        <Button
          label={t('safety.sleepSend')}
          variant="secondary"
          icon="send"
          disabled={!safety.sleepReportSupported || busy}
          onPress={() =>
            run(async () => {
              const outcome = await HuaweiWear.sendSleepReportNow();
              setSleepNote(outcome === 'sent' ? t('safety.sleepSent') : t('safety.sleepNotSent', { outcome }));
            })
          }
        />
        {sleepNote ? <Notice>{sleepNote}</Notice> : null}
        <Details>{t('safety.sleepDetails')}</Details>
      </Section>
    </>
  );
}

import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatAgo } from '@/format';
import { useNow } from '@/hooks/useNow';
import { useWatch } from '@/state/WatchProvider';
import { HuaweiWear } from '@/wear';

/** Keeps "asked 5 min ago" right while the screen stays open. */
const AGO_TICK_MS = 30_000;

/**
 * The Healthy Living tasks (Huawei Health's daily goals ring) on the watch. The watch asks for its
 * tasks over the P2P service; the switch decides whether the phone answers, the button pushes
 * today's tasks without waiting for a request.
 */
export function HealthyLivingSection() {
  const { t } = useTranslation('settings');
  const { linkState } = useWatch();
  const nowSec = Math.floor(useNow(AGO_TICK_MS) / 1000);
  // Re-read when the screen gains focus, an action ends, or the link changes (the gate and the registration follow the link).
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useNativeRefresh(refresh);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` and `linkState` are the triggers, the native read has no inputs
  const status = useMemo(() => HuaweiWear.getHealthyLiving(), [version, linkState]);

  const run = async (action: () => Promise<void>) => {
    setError(null);
    setNote(null);
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

  return (
    <Section title={t('healthyLiving.title')} icon="leaf" tint="link">
      <SwitchRow
        icon="checkmark-done"
        label={t('healthyLiving.answer')}
        value={status.enabled}
        disabled={busy}
        onValueChange={(enabled) => run(() => HuaweiWear.setHealthyLivingEnabled(enabled))}
      />
      <PairGrid>
        <Pair label={t('healthyLiving.support')}
          value={status.supported ? t('healthyLiving.supported') : t('healthyLiving.notSupported')} />
        <Pair
          label={t('healthyLiving.lastRequest')}
          value={status.lastRequestAt === null ? t('healthyLiving.notYet') : formatAgo(status.lastRequestAt / 1000, nowSec)}
        />
        <Pair label={t('healthyLiving.msgVersion')} value={status.msgVer === null ? null : String(status.msgVer)} />
        <Pair label={t('healthyLiving.lastReport')} value={status.lastReport} />
      </PairGrid>
      <AppText variant="caption" muted>
        {status.gate}
      </AppText>
      <Button
        label={t('healthyLiving.send')}
        variant="secondary"
        icon="send"
        disabled={busy || !status.supported}
        onPress={() =>
          run(async () => {
            const sent = await HuaweiWear.pushHealthyLiving();
            setNote(sent ? t('healthyLiving.sent') : t('healthyLiving.notAsked'));
          })
        }
      />
      {note ? <Notice>{note}</Notice> : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Details>{t('healthyLiving.details')}</Details>
    </Section>
  );
}

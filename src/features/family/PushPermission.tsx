import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { enablePush, pushAllowed, type PushOutcome } from '@/features/family/push';

interface PushPermissionProps {
  /** Why notifications, as the person reads it before the system prompt (`prePermissionBody`). */
  body: string;
  /** Added to the "cannot get notifications on this phone" notice: what else still works. */
  unavailableHint?: string;
}

/**
 * Turning notifications on. The button opens an explanation first; only its "Lanjut" starts the system prompt and
 * registers this phone's push token with the Worker.
 */
export function PushPermission({ body, unavailableHint }: PushPermissionProps) {
  const { t } = useTranslation(['family', 'common']);
  const [outcome, setOutcome] = useState<PushOutcome | 'idle' | 'checking'>('checking');
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void pushAllowed().then((allowed) => live && setOutcome(allowed ? 'enabled' : 'idle'));
    return () => {
      live = false;
    };
  }, []);

  const proceed = async () => {
    setAsking(false);
    setBusy(true);
    try {
      setOutcome(await enablePush());
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title={t('family:push.section')} icon="notifications" tint="steps">
      {outcome === 'enabled' ? (
        <AppText variant="caption" muted>
          {t('family:push.enabled', { late: t('family:push.late') })}
        </AppText>
      ) : null}
      {outcome === 'denied' ? (
        <Notice icon="notifications-off" action={{ label: t('family:push.openSettings'), onPress: () => void Linking.openSettings() }}>
          {t('family:push.denied')}
        </Notice>
      ) : null}
      {outcome === 'unavailable' ? (
        <Notice icon="notifications-off">
          {unavailableHint ? t('family:push.unavailableWithHint', { hint: unavailableHint }) : t('family:push.unavailable')}
        </Notice>
      ) : null}
      {outcome === 'idle' || outcome === 'denied' || outcome === 'checking' ? (
        <Button
          label={t('family:push.enable')}
          icon="notifications"
          variant="primary"
          disabled={outcome === 'checking' || outcome === 'denied'}
          loading={busy}
          onPress={() => setAsking(true)}
        />
      ) : null}
      <ConfirmDialog
        visible={asking}
        title={t('family:push.askTitle')}
        message={body}
        confirmLabel={t('common:actions.next')}
        cancelLabel={t('family:push.notNow')}
        onConfirm={() => void proceed()}
        onCancel={() => setAsking(false)}
      />
    </Section>
  );
}

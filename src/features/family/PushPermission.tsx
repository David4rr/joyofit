import { useEffect, useState } from 'react';
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
    <Section title="Notifikasi" icon="notifications" tint="steps">
      {outcome === 'enabled' ? (
        <AppText variant="caption" muted>
          Notifikasi aktif di ponsel ini. Notifikasi bisa terlambat dan tidak menjamin kamu langsung tahu.
        </AppText>
      ) : null}
      {outcome === 'denied' ? (
        <Notice icon="notifications-off" action={{ label: 'Buka pengaturan ponsel', onPress: () => void Linking.openSettings() }}>
          Notifikasi dimatikan untuk JoyoFit. Nyalakan di pengaturan ponsel kalau kamu berubah pikiran.
        </Notice>
      ) : null}
      {outcome === 'unavailable' ? (
        <Notice icon="notifications-off">
          Ponsel ini tidak bisa menerima notifikasi dari JoyoFit.{unavailableHint ? ` ${unavailableHint}` : ''}
        </Notice>
      ) : null}
      {outcome === 'idle' || outcome === 'denied' || outcome === 'checking' ? (
        <Button
          label="Aktifkan notifikasi"
          icon="notifications"
          variant="primary"
          disabled={outcome === 'checking' || outcome === 'denied'}
          loading={busy}
          onPress={() => setAsking(true)}
        />
      ) : null}
      <ConfirmDialog
        visible={asking}
        title="Aktifkan notifikasi?"
        message={body}
        confirmLabel="Lanjut"
        cancelLabel="Nanti saja"
        onConfirm={() => void proceed()}
        onCancel={() => setAsking(false)}
      />
    </Section>
  );
}

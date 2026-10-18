import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Section } from '@/components/Screen';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { OTA_ENABLED, useOtaUpdate } from '@/features/updates/useOtaUpdate';
import type { OtaPhase } from '@/features/updates/otaPolicy';

const STATUS: Record<OtaPhase, string> = {
  disabled: 'Off',
  idle: 'Up to date',
  checking: 'Checking…',
  downloading: 'Downloading…',
  ready: 'Ready, restart to apply',
  error: "Couldn't check",
};

/**
 * About screen block for over-the-air JS updates (expo-updates, docs/ota.md): which bundle runs, whether a
 * newer one is downloading or waiting for a restart, and a manual check. Renders nothing in dev clients and
 * Expo Go, where OTA is off.
 */
export function OtaSection() {
  const ota = useOtaUpdate();
  if (!OTA_ENABLED) return null;

  const busy = ota.phase === 'checking' || ota.phase === 'downloading';
  const running =
    ota.source === 'update' && ota.updateId
      ? `Update ${ota.updateId.slice(0, 8)}${ota.createdAt ? ` (${ota.createdAt.toISOString().slice(0, 10)})` : ''}`
      : ota.source === 'emergency'
        ? 'Built into the app (the last update failed to load)'
        : 'Built into the app';
  const status = ota.phase === 'downloading' && ota.percent !== null ? `Downloading ${ota.percent}%` : STATUS[ota.phase];

  return (
    <Section title="Quick updates" icon="cloud-download">
      <PairGrid>
        <Pair label="Status" value={status} />
        <Pair label="Channel" value={ota.channel} />
        <Pair label="Running" value={running} wide />
        <Pair label="Runtime" value={ota.runtimeVersion ? ota.runtimeVersion.slice(0, 8) : null} />
      </PairGrid>
      <AppText variant="caption" muted>
        Fixes to screens and logic arrive in the background and apply the next time JoyoFit opens. App Store and Play
        updates still carry anything native.
      </AppText>
      <ButtonRow>
        {ota.phase === 'ready' ? (
          <Button label="Restart to update" variant="primary" onPress={() => void ota.restart()} />
        ) : null}
        <Button
          label={busy ? 'Checking…' : 'Check for updates'}
          onPress={() => void ota.check()}
          loading={busy}
          disabled={busy}
        />
      </ButtonRow>
    </Section>
  );
}

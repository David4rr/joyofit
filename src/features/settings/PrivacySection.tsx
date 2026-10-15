import { AppText } from '@/components/AppText';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';

/**
 * Explains the companion app's offline-first privacy guarantee.
 */
export function PrivacySection() {
  return (
    <Section title="Offline Privacy" icon="shield-checkmark">
      <Notice icon="shield-checkmark">
        100% Offline-First: No accounts, no cloud servers, no analytics.
      </Notice>
      <AppText variant="caption" muted>
        Your biometric data (continuous heart rate, TruSleep stages, SpO2, steps, and GPS workouts)
        is stored exclusively in your phone&apos;s local SQLite database. No data leaves your device
        unless you explicitly sync with Android Health Connect.
      </AppText>
      <KeyValue icon="server" label="Cloud sync" value="Disabled (Local-only)" />
      <KeyValue icon="lock-closed" label="Telemetry" value="None" />
      <KeyValue icon="phone-portrait" label="Storage" value="Local SQLite" />
    </Section>
  );
}

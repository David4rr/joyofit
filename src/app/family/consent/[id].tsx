import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';

import { family, type FamilyScopes } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card, Divider, Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import {
  CONSENT_DEFAULT_SCOPES,
  consentAlerts,
  consentIntro,
  consentRevoke,
  consentTitle,
  NEVER_SHARED,
  SCOPE_ROWS,
} from '@/features/family/copy';
import { DisclaimerCard } from '@/features/family/DisclaimerCard';
import { FamilyGate } from '@/features/family/FamilyGate';
import { useFamilyLinks } from '@/features/family/FamilyProvider';

/**
 * The monitored person's consent, before anything is shared. Every category is off until they turn it on (only the
 * watch's last sync time and battery are required). The not-real-time notice comes first.
 */
export default function ConsentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ctx = useFamilyLinks();
  const link = ctx.watchedBy.find((item) => item.id === id);
  const [scopes, setScopes] = useState<FamilyScopes>(CONSENT_DEFAULT_SCOPES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const later = () => (router.canGoBack() ? router.back() : router.replace('/family'));

  const agree = async () => {
    setBusy(true);
    setError(null);
    try {
      await family.links.update(id, { scopes, consent: true });
      await ctx.refresh();
      router.replace('/family/me');
    } catch (e) {
      setError(ctx.fail(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <FamilyGate>
        {link ? (
          link.status === 'pending' ? (
            <>
              <AppText variant="title" accessibilityRole="header">
                {consentTitle(link.otherName)}
              </AppText>
              <DisclaimerCard />
              <Card>
                <AppText variant="body">{consentIntro(link.otherName)}</AppText>
                {SCOPE_ROWS.map((row) => (
                  <SwitchRow
                    key={row.key}
                    label={row.label}
                    hint={row.hint}
                    value={scopes[row.key]}
                    disabled={row.key === 'sync'}
                    onValueChange={(on) => setScopes((current) => ({ ...current, [row.key]: on }))}
                  />
                ))}
                <Divider />
                <AppText variant="caption" muted>
                  {NEVER_SHARED}
                </AppText>
                <AppText variant="caption" muted>
                  {consentAlerts(link.otherName)}
                </AppText>
                <AppText variant="caption" muted>
                  {consentRevoke(link.otherName)}
                </AppText>
              </Card>
              {error ? <Notice tone="danger">{error}</Notice> : null}
              <Button label="Lanjut" variant="primary" loading={busy} onPress={() => void agree()} />
              <Button label="Nanti saja" disabled={busy} onPress={later} />
            </>
          ) : (
            <Notice action={{ label: 'Lihat yang dibagikan', onPress: () => router.replace('/family/me') }}>
              Izin ini sudah kamu atur. Pengaturannya ada di layar Dipantau.
            </Notice>
          )
        ) : ctx.loading ? (
          <Skeleton width="100%" height={240} radius="card" />
        ) : (
          <Notice tone="danger" action={{ label: 'Kembali', onPress: later }}>
            {ctx.error ?? 'Permintaan ini tidak ditemukan. Mungkin sudah dibatalkan.'}
          </Notice>
        )}
      </FamilyGate>
    </Screen>
  );
}

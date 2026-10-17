import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Platform } from 'react-native';

import { family } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Card, Screen, Section } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { PLATFORM_NOTE, prePermissionMonitoredBody } from '@/features/family/copy';
import { DisclaimerCard } from '@/features/family/DisclaimerCard';
import { FamilyGate } from '@/features/family/FamilyGate';
import { useFamilyLinks } from '@/features/family/FamilyProvider';
import { clockLabel } from '@/features/family/format';
import { PayloadDialog } from '@/features/family/PayloadDialog';
import { PushPermission } from '@/features/family/PushPermission';
import { WatcherSection } from '@/features/family/WatcherSection';

/** The monitored side: who can see you and what, a pause, the data last sent, and the way out. No covert mode: this is always visible. */
export default function MeScreen() {
  const router = useRouter();
  const ctx = useFamilyLinks();
  const [refreshing, setRefreshing] = useState(false);
  const [last, setLast] = useState<{ payload: string | null; at: string | null } | null>(null);
  const [lastBusy, setLastBusy] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = async () => {
    setRefreshing(true);
    await ctx.refresh();
    setRefreshing(false);
  };

  const showLast = async () => {
    setLastBusy(true);
    setLastError(null);
    try {
      const answer = await family.lastPayload();
      setLast({ payload: answer.payload, at: answer.at === null ? null : clockLabel(answer.at, Date.now()) });
    } catch (e) {
      setLastError(ctx.fail(e));
    } finally {
      setLastBusy(false);
    }
  };

  const consented = ctx.watchedBy.some((link) => link.status === 'active' || link.status === 'paused');
  const full = ctx.limits !== null && ctx.watchedBy.length >= ctx.limits.maxWatchers;
  const askedName = ctx.watchedBy.find((link) => link.status === 'active' || link.status === 'paused')?.otherName ?? 'pemantaumu';

  return (
    <Screen refresh={{ refreshing, onRefresh: () => void refresh(), enabled: ctx.available }}>
      <FamilyGate>
        <DisclaimerCard />
        {ctx.loading ? (
          <Skeleton width="100%" height={200} radius="card" />
        ) : ctx.error !== null && ctx.limits === null ? (
          <Notice tone="danger" action={{ label: 'Coba lagi', onPress: () => void ctx.refresh() }}>
            {ctx.error}
          </Notice>
        ) : (
          <>
            {ctx.watchedBy.length === 0 ? (
              <Card>
                <EmptyState
                  icon="shield-checkmark"
                  title="Belum ada yang memantau kabarmu"
                  description="Kamu bisa mengundang seseorang untuk melihat kabar ringkas dari jam Huawei-mu. Kamu yang menentukan apa yang dibagikan, dan bisa berhenti kapan saja."
                />
              </Card>
            ) : (
              ctx.watchedBy.map((link) => <WatcherSection key={link.id} link={link} />)
            )}
            {full ? <Notice>Jumlah pemantau sudah maksimal. Putuskan salah satu dulu untuk mengundang yang baru.</Notice> : null}
            <Button
              label="Undang pemantau"
              icon="person-add"
              variant={ctx.watchedBy.length === 0 ? 'primary' : 'secondary'}
              disabled={full}
              onPress={() => router.push({ pathname: '/family/invite', params: { role: 'monitored' } })}
            />
            {consented ? (
              <>
                <Section title="Data yang terkirim" icon="document-text" tint="steps">
                  <AppText variant="caption" muted>
                    Ringkasan harian yang terakhir dikirim ponselmu, persis seperti yang disimpan server.
                  </AppText>
                  {lastError ? <Notice tone="danger">{lastError}</Notice> : null}
                  <Button label="Lihat data yang terkirim" icon="eye" loading={lastBusy} onPress={() => void showLast()} />
                </Section>
                <PushPermission body={prePermissionMonitoredBody(askedName)} />
              </>
            ) : null}
            <Section title="Kapan data terkirim" icon="information-circle">
              <AppText variant="caption" muted>
                {Platform.OS === 'ios' ? PLATFORM_NOTE.ios : PLATFORM_NOTE.android}
              </AppText>
            </Section>
          </>
        )}
        <PayloadDialog visible={last !== null} payload={last?.payload ?? null} at={last?.at ?? null} onClose={() => setLast(null)} />
      </FamilyGate>
    </Screen>
  );
}

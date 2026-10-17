import { useRouter } from 'expo-router';
import { useState } from 'react';

import { Button } from '@/components/Button';
import { NavRow } from '@/components/NavRow';
import { Card, Divider, Screen } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { watchCapacity } from '@/features/family/capacity';
import { DisclaimerCard } from '@/features/family/DisclaimerCard';
import { FamilyGate } from '@/features/family/FamilyGate';
import { useFamilyLinks } from '@/features/family/FamilyProvider';
import { PersonCard } from '@/features/family/PersonCard';

/** The watcher's dashboard: a card per person watched, and the way to invite another or to see who watches you. */
export default function FamilyScreen() {
  const router = useRouter();
  const family = useFamilyLinks();
  const [refreshing, setRefreshing] = useState(false);
  const [full, setFull] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    await family.refresh();
    setRefreshing(false);
  };

  const invite = () => {
    const capacity = watchCapacity(family.limits, family.watching.length);
    if (capacity === 'pro') family.showUpsell();
    else if (capacity === 'full') setFull(true);
    else router.push({ pathname: '/family/invite', params: { role: 'watcher' } });
  };

  return (
    <Screen refresh={{ refreshing, onRefresh: () => void refresh(), enabled: family.available }}>
      <FamilyGate>
        <DisclaimerCard />
        {family.loading ? (
          <Skeleton width="100%" height={140} radius="card" />
        ) : family.error !== null && family.limits === null ? (
          <Notice tone="danger" action={{ label: 'Coba lagi', onPress: () => void family.refresh() }}>
            {family.error}
          </Notice>
        ) : (
          <>
            {family.watching.length > 0 ? (
              <>
                {family.watching.map((item) => (
                  <PersonCard key={item.id} item={item} onPress={() => router.push({ pathname: '/family/[id]', params: { id: item.id } })} />
                ))}
                <Button label="Undang orang tua" icon="person-add" variant="primary" onPress={invite} />
              </>
            ) : (
              <Card>
                <EmptyState
                  icon="people"
                  title="Belum ada yang kamu pantau"
                  description="Undang orang tuamu. Kamu akan melihat kabar ringkas dari jam Huawei mereka, dan dapat pemberitahuan kalau ada yang tidak biasa. Mereka yang memutuskan apa yang dibagikan."
                  action={{ label: 'Undang orang tua', icon: 'person-add', onPress: invite }}
                />
              </Card>
            )}
            {full ? <Notice>Kamu sudah memantau jumlah orang maksimal. Hapus salah satu dulu untuk menambah yang baru.</Notice> : null}
          </>
        )}
        <Card>
          <NavRow
            icon="enter"
            tint="link"
            title="Masukkan kode undangan"
            subtitle="Kalau seseorang mengirim kode untukmu"
            onPress={() => router.push('/family/accept')}
          />
          <Divider />
          <NavRow
            icon="shield-checkmark"
            tint="steps"
            title="Dipantau"
            subtitle={
              family.watchedBy.some((link) => link.status === 'pending')
                ? 'Ada permintaan yang menunggu izinmu'
                : family.watchedBy.length > 0
                  ? `${family.watchedBy.length} orang bisa melihat kabarmu`
                  : 'Undang seseorang untuk memantau kabarmu, atau lihat apa yang kamu bagikan'
            }
            onPress={() => router.push('/family/me')}
          />
        </Card>
      </FamilyGate>
    </Screen>
  );
}

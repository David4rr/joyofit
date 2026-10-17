import { Redirect, Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { family, type FamilySummary, type FamilyWatchingItem } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { KeyValue } from '@/components/KeyValue';
import { NavRow } from '@/components/NavRow';
import { Card, Divider, Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { Segmented } from '@/components/Segmented';
import { allowedRange, HISTORY_RANGES, type HistoryRange } from '@/features/family/capacity';
import { ChipBadge } from '@/features/family/ChipBadge';
import { DisclaimerCard } from '@/features/family/DisclaimerCard';
import { FamilyGate } from '@/features/family/FamilyGate';
import { useFamily, useFamilyLinks } from '@/features/family/FamilyProvider';
import { describeFamilyError } from '@/features/family/errors';
import { FamilyTrend } from '@/features/family/FamilyTrend';
import {
  baselineNote,
  batteryText,
  clockLabel,
  dataAtText,
  newestDay,
  pauseText,
  restingHrText,
  sleepText,
  snoozeText,
  stepsText,
} from '@/features/family/format';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme';

const SNOOZES = [1, 3, 7] as const;

/** One watched person: today's numbers, the trend, how healthy the feed is, past alerts, and what to do about them. */
export default function MemberScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const ctx = useFamilyLinks();
  const item = ctx.watching.find((link) => link.id === id);
  const leave = () => router.replace('/family');

  // A poke notification lands on the monitored phone with this link's id: the person's own side is the Dipantau screen.
  if (!item && ctx.watchedBy.some((link) => link.id === id)) return <Redirect href="/family/me" />;

  return (
    <Screen>
      <FamilyGate>
        <DisclaimerCard />
        {item ? (
          <>
            <Stack.Screen options={{ title: item.label }} />
            {item.status === 'pending' || item.frozen ? <Waiting item={item} onGone={leave} /> : <Member item={item} onGone={leave} />}
          </>
        ) : ctx.loading ? (
          <Skeleton width="100%" height={180} radius="card" />
        ) : (
          <Notice tone="danger" action={{ label: 'Kembali', onPress: leave }}>
            {ctx.error ?? 'Orang ini tidak ditemukan. Mungkin sudah dihapus.'}
          </Notice>
        )}
      </FamilyGate>
    </Screen>
  );
}

/** Removing a link, asked first: it ends the sharing for both sides. */
function RemoveButton({ item, onGone }: { item: FamilyWatchingItem; onGone: () => void }) {
  const ctx = useFamily();
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setAsking(false);
    setBusy(true);
    setError(null);
    try {
      await family.links.remove(item.id);
      onGone();
      void ctx.refresh();
    } catch (e) {
      setError(ctx.fail(e));
      setBusy(false);
    }
  };

  return (
    <>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button
        label={item.status === 'pending' ? 'Batalkan undangan' : `Berhenti memantau ${item.label}`}
        variant="destructive"
        icon="trash"
        loading={busy}
        onPress={() => setAsking(true)}
      />
      <ConfirmDialog
        visible={asking}
        title={`Berhenti memantau ${item.label}?`}
        message={`Kamu tidak akan melihat kabar ${item.otherName} lagi, dan ${item.otherName} langsung tahu bahwa tautan ini putus. Kalau mau memantau lagi, kalian harus membuat undangan baru.`}
        confirmLabel="Berhenti memantau"
        cancelLabel="Batal"
        onConfirm={() => void remove()}
        onCancel={() => setAsking(false)}
      />
    </>
  );
}

/** A link with nothing to show yet: waiting for consent, or over the free limit. */
function Waiting({ item, onGone }: { item: FamilyWatchingItem; onGone: () => void }) {
  return (
    <>
      <Notice icon="time">
        {item.status === 'pending'
          ? `Menunggu ${item.otherName} menyetujui. Belum ada data yang dikirim.`
          : 'Akun gratis memantau satu orang. Tautan ini tersimpan tapi tidak diperbarui.'}
      </Notice>
      <RemoveButton item={item} onGone={onGone} />
    </>
  );
}

function Member({ item, onGone }: { item: FamilyWatchingItem; onGone: () => void }) {
  const router = useRouter();
  const ctx = useFamily();
  const nowMs = useNow(60_000);
  const [wanted, setWanted] = useState<HistoryRange>(7);
  const range = allowedRange(ctx.limits, wanted);
  const load = useCallback(() => family.links.summary(item.id, range), [item.id, range]);
  const { data, error, setData } = useRogoQuery(load, true, describeFamilyError);
  const [actionError, setActionError] = useState<string | null>(null);
  const [poked, setPoked] = useState<'sent' | 'unreached' | null>(null);
  const [poking, setPoking] = useState(false);

  const pick = (days: HistoryRange) => {
    if (ctx.limits !== null && days > ctx.limits.historyDays) ctx.showUpsell();
    else setWanted(days);
  };

  const poke = async () => {
    setPoking(true);
    setActionError(null);
    try {
      const { sent } = await family.links.poke(item.id);
      setPoked(sent ? 'sent' : 'unreached');
    } catch (e) {
      setActionError(ctx.fail(e));
    } finally {
      setPoking(false);
    }
  };

  const snooze = async (days: 1 | 3 | 7, summary: FamilySummary) => {
    setActionError(null);
    try {
      const { snoozeUntil } = await family.links.snooze(item.id, days);
      setData({ ...summary, snoozeUntil });
    } catch (e) {
      setActionError(ctx.fail(e));
    }
  };

  const paused = pauseText(item.pausedUntil, nowMs);
  const today = data ? newestDay(data.days) : null;
  /** The summary of a paused (or otherwise inactive) link is empty: only the alerts and the actions have anything to show. */
  const live = data?.link.status === 'active';
  const scopes = data?.link.scopes ?? item.scopes;

  return (
    <>
      <Card>
        <View style={styles.head}>
          <View style={styles.headText}>
            <AppText variant="heading">{item.otherName}</AppText>
            {paused ? null : (
              <AppText variant="caption" muted>
                {dataAtText(data?.dataAt ?? item.dataAt, nowMs)}
              </AppText>
            )}
          </View>
          {paused ? null : <ChipBadge chip={data?.chip ?? item.chip} />}
        </View>
        {paused ? <Notice icon="pause-circle">{`${item.otherName} menjeda berbagi data. ${paused}.`}</Notice> : null}
      </Card>

      {error !== null && !data ? <Notice tone="danger">{error}</Notice> : null}
      {!data && error === null ? <Skeleton width="100%" height={160} radius="card" /> : null}

      {data ? (
        <>
          {live ? (
            <>
          <Section title="Hari ini" icon="today" tint="link">
            {scopes.steps ? <KeyValue label="Langkah" value={today ? stepsText(today.steps) : null} /> : null}
            {scopes.restingHr ? (
              <KeyValue label="Detak istirahat" value={today ? restingHrText(today.restingHr, data.baseline.restingHr) : null} />
            ) : null}
            {scopes.sleep ? <KeyValue label="Tidur semalam" value={today?.sleepMin != null ? sleepText(today.sleepMin) : null} /> : null}
            {scopes.spo2 ? (
              <KeyValue label="Kadar oksigen terendah (kata jam)" value={today?.spo2Min != null ? `${Math.round(today.spo2Min)}%` : null} />
            ) : null}
            {!scopes.steps && !scopes.restingHr && !scopes.sleep && !scopes.spo2 ? (
              <AppText variant="caption" muted>
                {item.otherName} hanya membagikan waktu terakhir jam tersambung dan baterai.
              </AppText>
            ) : null}
            {scopes.restingHr && baselineNote(data.baseline) ? (
              <AppText variant="caption" muted>
                {baselineNote(data.baseline)}
              </AppText>
            ) : null}
          </Section>

          <Section title="Tren" icon="trending-up" tint="steps">
            <Segmented
              options={HISTORY_RANGES.map((days) => ({
                value: days,
                label: ctx.limits !== null && days > ctx.limits.historyDays ? `${days} hari (Pro)` : `${days} hari`,
              }))}
              value={range}
              onChange={pick}
            />
            <FamilyTrend days={data.days} range={range} scopes={scopes} baseline={data.baseline.restingHr} />
          </Section>

          <Section title="Kondisi sinkron" icon="sync" tint="link">
            <KeyValue label="Jam terakhir tersambung" value={data.state?.watchSyncAt != null ? clockLabel(data.state.watchSyncAt, nowMs) : null} />
            <KeyValue label="Ponsel terakhir terlihat" value={data.state?.phoneSeenAt != null ? clockLabel(data.state.phoneSeenAt, nowMs) : null} />
            <KeyValue label="Baterai jam" value={data.state ? batteryText(data.state.battery) : null} />
          </Section>
            </>
          ) : null}

          <Section title="Pemberitahuan" icon="notifications" tint="workouts">
            {data.alerts.length === 0 ? (
              <AppText variant="caption" muted>
                Belum ada pemberitahuan.
              </AppText>
            ) : (
              data.alerts.map((alert, i) => (
                <Fragment key={alert.id}>
                  {i > 0 ? <Divider /> : null}
                  <AppText variant="body">{alert.body}</AppText>
                  <AppText variant="caption" muted>
                    {clockLabel(alert.at, nowMs)}
                  </AppText>
                </Fragment>
              ))
            )}
            <Divider />
            <AppText variant="label" muted>
              {snoozeText(data.snoozeUntil, nowMs) ?? 'Senyapkan pemberitahuan'}
            </AppText>
            <View style={styles.chips}>
              {SNOOZES.map((days) => (
                <Chip key={days} label={`${days} hari`} selected={false} onPress={() => void snooze(days, data)} />
              ))}
            </View>
          </Section>
        </>
      ) : null}

      {poked === 'sent' ? <Notice icon="checkmark-circle">{`Pesan "Tanya kabar" terkirim ke ${item.otherName}. Notifikasi bisa terlambat.`}</Notice> : null}
      {poked === 'unreached' ? (
        <Notice icon="alert-circle">{`${item.otherName} belum bisa menerima notifikasi dari JoyoFit, jadi pesannya tidak sampai. Coba telepon langsung.`}</Notice>
      ) : null}
      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      <Button label="Tanya kabar" icon="chatbubble-ellipses" variant="primary" loading={poking} onPress={() => void poke()} />
      <Card>
        <NavRow
          icon="options"
          tint="steps"
          title="Atur pemberitahuan"
          subtitle="Aturan, jam tenang, notifikasi dan email"
          onPress={() => router.push({ pathname: '/family/rules/[id]', params: { id: item.id } })}
        />
      </Card>
      <RemoveButton item={item} onGone={onGone} />
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  headText: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

import * as Linking from 'expo-linking';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Details } from '@/components/Details';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { formatSize } from '@/cloud/estimate';
import { onUnmeteredNetwork } from '@/cloud/syncSettings';
import { formatCount, formatDateTime } from '@/format';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';
import { useTheme } from '@/theme';
import type { TFunction } from '@/i18n';
import { HuaweiWear } from '@/wear';

/** Where a sideloaded build sends someone to become Founder. */
const FOUNDER_URL = 'https://joyorogo.com/pro?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-cloud-settings';
/**
 * The Play build shows no purchase link: Google Play's payments policy does not allow pointing to an external
 * checkout from inside the app. JoyoRogo's own Play build does the same (billing off, no checkout, no price).
 */
const CAN_LINK_TO_FOUNDER = HuaweiWear.distribution !== 'play';

type T = TFunction<'settings'>;

const workoutsText = (t: T, count: number) => t('cloud.workouts', { count, n: formatCount(count) });

/** What is waiting to go up: the workouts with the size they will take, and the step and sleep rows. */
function waitingText(t: T, workouts: number, bytes: number, rows: number): string {
  const workoutsPart =
    workouts > 0 ? t('cloud.waiting.workouts', { workouts: workoutsText(t, workouts), size: formatSize(bytes) }) : null;
  const rowsPart = rows > 0 ? t('cloud.waiting.rows', { count: rows, n: formatCount(rows) }) : null;
  if (workoutsPart && rowsPart) return t('cloud.waiting.both', { first: workoutsPart, second: rowsPart });
  return workoutsPart ?? rowsPart ?? t('cloud.waiting.nothing');
}

/**
 * Sign in with the JoyoRogo account and sync with the cloud. With a Pro account every workout (GPS, heart rate, speed,
 * cadence, power and the analysis) goes up as a compressed file, steps and sleep go to the JoyoFit cloud, and a new
 * phone restores its workouts after sign-in. Syncs run on their own after each watch sync; "Sync now" forces one, and
 * "Wi-Fi only" keeps the automatic ones off mobile data. Without Pro nothing is uploaded and the workouts stay on the phone.
 * Signing out and deleting the account live in the Settings hub (`useAccountDialogs`); "Delete cloud data", which keeps the
 * account, closes this screen as a destructive row.
 */
export function CloudSection() {
  const { t } = useTranslation('settings');
  const cloud = useCloud();
  const theme = useTheme();
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [confirmingMobile, setConfirmingMobile] = useState(false);
  const busy = cloud.uploading || cloud.deleting || cloud.wiping;

  const syncNow = async () => {
    if (cloud.wifiOnly && !(await onUnmeteredNetwork())) setConfirmingMobile(true);
    else await cloud.syncNow();
  };

  return (
    <>
      <Section title={t('cloud.title')} icon="cloud-upload">
        {!cloud.configured ? (
          <Notice tone="danger">
            {t('cloud.notConfigured')}
          </Notice>
        ) : null}
        {cloud.signedIn && cloud.locked ? (
          <Notice
            icon="lock-closed"
            action={
              CAN_LINK_TO_FOUNDER
                ? { label: t('cloud.getPro'), onPress: () => void Linking.openURL(FOUNDER_URL) }
                : undefined
            }>
            {CAN_LINK_TO_FOUNDER
              ? t('cloud.lockedLink')
              : t('cloud.locked')}
          </Notice>
        ) : null}
        {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
        {cloud.progress ? (
          <Notice icon="cloud-upload">{t('cloud.uploading', { done: formatCount(cloud.progress.done), total: formatCount(cloud.progress.total) })}</Notice>
        ) : null}
        {cloud.refusedWorkouts > 0 ? (
          <Notice tone="danger">
            {t('cloud.refused', { count: cloud.refusedWorkouts, n: formatCount(cloud.refusedWorkouts) })}
            {cloud.refusedError ? ` ${t('cloud.refusedError', { error: cloud.refusedError })}` : ''}
          </Notice>
        ) : null}
        <PairGrid>
          <Pair label={t('cloud.labels.account')} value={cloud.signedIn ? cloud.email : null} wide />
          {cloud.signedIn ? (
            <>
              <Pair label={t('cloud.labels.lastSync')} value={cloud.lastSyncAt ? formatDateTime(cloud.lastSyncAt) : null} />
              <Pair
                label={t('cloud.labels.inCloud')}
                value={
                  cloud.cloudWorkouts
                    ? t('cloud.inCloudValue', {
                        workouts: workoutsText(t, cloud.cloudWorkouts.count),
                        used: formatSize(cloud.cloudWorkouts.bytes),
                        quota: formatSize(cloud.cloudWorkouts.quotaBytes),
                      })
                    : null
                }
              />
              {cloud.locked ? null : (
                <Pair
                  label={t('cloud.labels.waiting')}
                  value={
                    cloud.pendingWorkouts == null || cloud.pendingRows == null || cloud.pendingBytes == null
                      ? null
                      : waitingText(t, cloud.pendingWorkouts, cloud.pendingBytes, cloud.pendingRows)
                  }
                  wide
                />
              )}
            </>
          ) : null}
        </PairGrid>
        {cloud.signedIn ? (
          <>
            <Button
              label={t('cloud.syncNow')}
              variant="primary"
              icon="sync"
              onPress={() => void syncNow()}
              disabled={!cloud.configured || cloud.deleting || cloud.wiping}
              loading={cloud.uploading}
            />
            <SwitchRow
              label={t('cloud.wifiOnly')}
              hint={t('cloud.wifiOnlyHint')}
              icon="wifi"
              value={cloud.wifiOnly}
              onValueChange={cloud.setWifiOnly}
            />
            <SwitchRow
              label={t('cloud.autoSync')}
              hint={t('cloud.autoSyncHint')}
              icon="sync"
              value={cloud.autoSync}
              onValueChange={cloud.setAutoSync}
              disabled={cloud.wiping}
            />
          </>
        ) : (
          <SignInButtons />
        )}
        <ConfirmDialog
          visible={confirmingMobile}
          title={t('cloud.mobileTitle')}
          message={t('cloud.mobileMessage')}
          confirmLabel={t('cloud.syncNow')}
          onConfirm={() => {
            setConfirmingMobile(false);
            void cloud.syncNow();
          }}
          onCancel={() => setConfirmingMobile(false)}
        />
        <ConfirmDialog
          visible={confirmingWipe}
          title={t('cloud.wipeTitle')}
          message={t('cloud.wipeMessage')}
          confirmLabel={t('cloud.wipe')}
          destructive
          busy={cloud.wiping}
          onConfirm={() => void cloud.wipeCloud().finally(() => setConfirmingWipe(false))}
          onCancel={() => setConfirmingWipe(false)}
        />
        <Details>{t('cloud.details')}</Details>
      </Section>
      {cloud.signedIn ? (
        <NavRow
          destructive
          icon="cloud-offline-outline"
          title={t('cloud.wipe')}
          disabled={busy}
          onPress={() => setConfirmingWipe(true)}
          style={groupedRowStyle(theme, 0, 1)}
        />
      ) : null}
    </>
  );
}

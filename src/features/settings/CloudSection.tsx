import * as Linking from 'expo-linking';
import { useState } from 'react';

import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { isIos } from '@/components/IosUnavailable';
import { SwitchRow } from '@/components/SwitchRow';
import { formatSize } from '@/cloud/estimate';
import { onUnmeteredNetwork } from '@/cloud/syncSettings';
import { formatCount, formatDateTime } from '@/format';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';
import { HuaweiWear } from '@/wear';

/** Where a sideloaded build sends someone to become Founder. */
const FOUNDER_URL = 'https://joyorogo.com/pro?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-cloud-settings';
/**
 * The Play build shows no purchase link: Google Play's payments policy does not allow pointing to an external
 * checkout from inside the app. JoyoRogo's own Play build does the same (billing off, no checkout, no price).
 */
const CAN_LINK_TO_FOUNDER = HuaweiWear.distribution !== 'play';

const workoutsText = (count: number) => `${formatCount(count)} ${count === 1 ? 'workout' : 'workouts'}`;

/** What is waiting to go up: the workouts with the size they will take, and the step and sleep rows. */
function waitingText(workouts: number, bytes: number, rows: number): string {
  const parts: string[] = [];
  if (workouts > 0) parts.push(`${workoutsText(workouts)}, about ${formatSize(bytes)}`);
  if (rows > 0) parts.push(`${formatCount(rows)} step and sleep ${rows === 1 ? 'row' : 'rows'}`);
  return parts.length > 0 ? parts.join(' and ') : 'Nothing';
}

/**
 * Sign in with the JoyoRogo account and sync with the cloud. With a Pro account every workout (GPS, heart rate, speed,
 * cadence, power and the analysis) goes up as a compressed file, steps and sleep go to the JoyoFit cloud, and a new
 * phone restores its workouts after sign-in. Syncs run on their own after each watch sync; "Sync now" forces one, and
 * "Wi-Fi only" keeps the automatic ones off mobile data. Without Pro nothing is uploaded and the workouts stay on the phone.
 */
export function CloudSection() {
  const cloud = useCloud();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [confirmingWipe, setConfirmingWipe] = useState(false);
  const [confirmingMobile, setConfirmingMobile] = useState(false);
  const withApple = isIos && cloud.appleAvailable;
  const busy = cloud.uploading || cloud.deleting || cloud.wiping;

  const syncNow = async () => {
    if (cloud.wifiOnly && !(await onUnmeteredNetwork())) setConfirmingMobile(true);
    else await cloud.syncNow();
  };

  return (
    <Section title="Cloud sync" icon="cloud-upload">
      {!cloud.configured ? (
        <Notice tone="danger">
          No cloud server URL in this build. Deploy server/, set EXPO_PUBLIC_JOYOFIT_CLOUD_URL, rebuild.
        </Notice>
      ) : null}
      {cloud.signedIn && cloud.locked ? (
        <Notice
          icon="lock-closed"
          action={
            CAN_LINK_TO_FOUNDER
              ? { label: 'Get Pro', onPress: () => void Linking.openURL(FOUNDER_URL) }
              : undefined
          }>
          {CAN_LINK_TO_FOUNDER
            ? 'Your workouts stay on this phone. Cloud sync is a JoyoRogo Pro benefit. What is already in your cloud stays readable and restores onto a new phone.'
            : 'Your workouts stay on this phone. Cloud sync is a JoyoRogo Pro benefit (get Pro in JoyoRogo). What is already in your cloud stays readable and restores onto a new phone.'}
        </Notice>
      ) : null}
      {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
      {cloud.progress ? (
        <Notice icon="cloud-upload">{`Uploading ${formatCount(cloud.progress.done)} of ${formatCount(cloud.progress.total)}`}</Notice>
      ) : null}
      {cloud.refusedWorkouts > 0 ? (
        <Notice tone="danger">
          {`${workoutsText(cloud.refusedWorkouts)} could not be uploaded. They are tried again after the next app update.${cloud.refusedError ? ` Last error: ${cloud.refusedError}` : ''}`}
        </Notice>
      ) : null}
      <PairGrid>
        <Pair label="Account" value={cloud.signedIn ? cloud.email : null} wide />
        {cloud.signedIn ? (
          <>
            <Pair label="Last sync" value={cloud.lastSyncAt ? formatDateTime(cloud.lastSyncAt) : null} />
            <Pair
              label="In the cloud"
              value={
                cloud.cloudWorkouts
                  ? `${workoutsText(cloud.cloudWorkouts.count)}, ${formatSize(cloud.cloudWorkouts.bytes)} of ${formatSize(cloud.cloudWorkouts.quotaBytes)}`
                  : null
              }
            />
            {cloud.locked ? null : (
              <Pair
                label="Waiting to upload"
                value={
                  cloud.pendingWorkouts == null || cloud.pendingRows == null || cloud.pendingBytes == null
                    ? null
                    : waitingText(cloud.pendingWorkouts, cloud.pendingBytes, cloud.pendingRows)
                }
                wide
              />
            )}
          </>
        ) : null}
      </PairGrid>
      {cloud.signedIn ? (
        <>
          <ButtonRow>
            <Button
              label="Sync now"
              variant="primary"
              icon="sync"
              onPress={() => void syncNow()}
              disabled={!cloud.configured || cloud.deleting || cloud.wiping}
              loading={cloud.uploading}
            />
            <Button
              label="Sign out"
              variant="secondary"
              icon="log-out-outline"
              onPress={() => void cloud.signOut()}
              disabled={busy}
            />
          </ButtonRow>
          <SwitchRow
            label="Wi-Fi only"
            hint="Automatic sync waits for Wi-Fi or Ethernet, so workouts do not use mobile data."
            icon="wifi"
            value={cloud.wifiOnly}
            onValueChange={cloud.setWifiOnly}
          />
          <SwitchRow
            label="Automatic sync"
            hint="Sync after each watch sync and when you open the app."
            icon="sync"
            value={cloud.autoSync}
            onValueChange={cloud.setAutoSync}
            disabled={cloud.wiping}
          />
          <Button
            label="Delete cloud data"
            variant="destructive"
            icon="cloud-offline-outline"
            loading={cloud.wiping}
            disabled={busy}
            onPress={() => setConfirmingWipe(true)}
          />
          {confirmingDelete ? (
            <Notice tone="danger" icon="trash">
              Deletes your JoyoRogo account (the one JoyoRogo uses) and everything it holds in the cloud: your JoyoRogo
              diary, groups and photos, and the data JoyoFit backed up. Cannot be undone; you are signed out of both
              apps. Data on this phone stays.{withApple ? ' Apple will ask you to confirm first.' : ''}
            </Notice>
          ) : null}
          {confirmingDelete ? (
            <ButtonRow>
              <Button
                label="Delete permanently"
                variant="destructive"
                icon="trash"
                loading={cloud.deleting}
                onPress={() => void cloud.deleteAccount().then((deleted) => deleted && setConfirmingDelete(false))}
              />
              <Button
                label="Keep account"
                variant="secondary"
                disabled={cloud.deleting}
                onPress={() => setConfirmingDelete(false)}
              />
            </ButtonRow>
          ) : (
            <Button
              label="Delete JoyoRogo account"
              variant="destructive"
              icon="trash-outline"
              disabled={busy}
              onPress={() => setConfirmingDelete(true)}
            />
          )}
        </>
      ) : (
        <SignInButtons />
      )}
      <ConfirmDialog
        visible={confirmingMobile}
        title="Sync on mobile data?"
        message="Wi-Fi only is on and this phone is not on Wi-Fi. Syncing now can use a lot of mobile data when workouts are waiting."
        confirmLabel="Sync now"
        onConfirm={() => {
          setConfirmingMobile(false);
          void cloud.syncNow();
        }}
        onCancel={() => setConfirmingMobile(false)}
      />
      <ConfirmDialog
        visible={confirmingWipe}
        title="Delete cloud data?"
        message="Removes your workouts, steps and sleep from the cloud. This phone's data and your account stay, and automatic sync is turned off so nothing is uploaded again until you turn it back on."
        confirmLabel="Delete cloud data"
        onConfirm={() => {
          setConfirmingWipe(false);
          void cloud.wipeCloud();
        }}
        onCancel={() => setConfirmingWipe(false)}
      />
      <Details>
        Cloud sync is part of JoyoRogo Pro. With a Pro account every workout is uploaded to your JoyoRogo account as one
        compressed file: its GPS track, heart rate, speed, cadence and power, and the analysis the app shows, so it
        survives a lost phone, shows on the JoyoRogo web and restores onto a new phone after you sign in. Steps, heart
        rate, SpO2, sleep and the watch&apos;s Bluetooth address go to the JoyoFit cloud with the same account. Without
        Pro nothing is uploaded and your workouts stay on this phone. While you are signed in the app also reads from the
        cloud: it downloads workouts this phone does not have, and removes the ones you deleted from the cloud
        elsewhere. JoyoFit also exchanges meals, weight and daily scores with JoyoRogo. Delete cloud data removes your
        workouts, steps and sleep from the cloud and keeps this phone&apos;s data and your account; Delete JoyoRogo account
        removes the account and everything else (details at fit.joyorogo.com/privasi).
      </Details>
    </Section>
  );
}

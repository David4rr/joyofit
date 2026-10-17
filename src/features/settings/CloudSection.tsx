import * as Linking from 'expo-linking';
import { useState } from 'react';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Details } from '@/components/Details';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { isIos } from '@/components/IosUnavailable';
import { formatCount, formatDateTime } from '@/format';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useCloud } from '@/state/CloudProvider';
import { HuaweiWear } from '@/wear';

/** Where a sideloaded build sends someone to become Founder. */
const FOUNDER_URL = 'https://joyorogo.com/pro?from=joyofit&utm_source=joyofit&utm_medium=app&utm_campaign=evergreen-cloud-settings';
/**
 * The Play build shows no purchase link: Google Play's payments policy does not allow pointing to an external
 * checkout from inside the app. JoyoRogo's own Play build does the same (billing off, no checkout, no price).
 */
const CAN_LINK_TO_FOUNDER = HuaweiWear.distribution !== 'play';

/**
 * Sign in with the JoyoRogo account and upload the local data to the JoyoFit cloud, a JoyoRogo Founder benefit.
 * Uploads run on their own after each sync; "Sync now" is for forcing one. Nothing is downloaded back into the
 * app yet. Without Founder the section says so and uploads stay off.
 */
export function CloudSection() {
  const cloud = useCloud();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const withApple = isIos && cloud.appleAvailable;

  return (
    <Section title="Cloud" icon="cloud-upload">
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
            ? 'Not a Pro account, so nothing is uploaded. Your data stays on this phone; what is already in the cloud stays readable.'
            : 'Not a Pro account (get Pro in JoyoRogo), so nothing is uploaded. Your data stays on this phone; what is already in the cloud stays readable.'}
        </Notice>
      ) : null}
      {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
      <PairGrid>
        <Pair label="Account" value={cloud.signedIn ? cloud.email : null} wide />
        {cloud.signedIn ? (
          <>
            <Pair label="Last cloud sync" value={cloud.lastSyncAt ? formatDateTime(cloud.lastSyncAt) : null} />
            <Pair label="Waiting to upload" value={cloud.pending == null ? null : `${formatCount(cloud.pending)} rows`} />
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
              onPress={() => void cloud.syncNow()}
              disabled={!cloud.configured}
              loading={cloud.uploading}
            />
            <Button
              label="Sign out"
              variant="secondary"
              icon="log-out-outline"
              onPress={() => void cloud.signOut()}
              disabled={cloud.uploading || cloud.deleting}
            />
          </ButtonRow>
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
              disabled={cloud.uploading || cloud.deleting}
              onPress={() => setConfirmingDelete(true)}
            />
          )}
        </>
      ) : withApple ? (
        <>
          <AppText variant="label" muted>
            Sign in with
          </AppText>
          <ButtonRow>
            <Button
              label="Apple"
              variant="primary"
              icon="logo-apple"
              onPress={() => void cloud.signInApple()}
              disabled={cloud.sessionPending}
            />
            <Button
              label="Google"
              variant="secondary"
              icon="logo-google"
              onPress={() => void cloud.signIn()}
              disabled={cloud.sessionPending}
              loading={cloud.sessionPending}
            />
          </ButtonRow>
        </>
      ) : (
        <Button
          label="Sign in with JoyoRogo"
          variant="primary"
          icon="log-in-outline"
          onPress={() => void cloud.signIn()}
          disabled={cloud.sessionPending}
          loading={cloud.sessionPending}
        />
      )}
      <Details>
        Cloud backup is part of JoyoRogo Pro. It backs up your steps, heart rate, SpO2, sleep and workouts, including GPS
        tracks and the watch&apos;s Bluetooth address, to the JoyoFit cloud with your JoyoRogo account. Off until you
        sign in with a Pro account; after that it uploads on its own, starting with your whole history. While signed
        in, JoyoFit also exchanges meals, weight and daily scores with JoyoRogo. To delete your account and its cloud
        data, sign in and use Delete JoyoRogo account (details at fit.joyorogo.com/privasi). The app never reads from
        the cloud yet.
      </Details>
    </Section>
  );
}

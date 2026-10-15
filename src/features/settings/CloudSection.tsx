import * as Linking from 'expo-linking';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { KeyValue } from '@/components/KeyValue';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { formatCount, formatDateTime } from '@/format';
import { useCloud } from '@/state/CloudProvider';
import { HuaweiWear } from '@/wear';

/** Where a sideloaded build sends someone to become Founder. */
const FOUNDER_URL = 'https://joyorogo.com/founder?from=joyofit';
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

  return (
    <Section title="Cloud" icon="cloud-upload">
      <AppText variant="caption" muted>
        Cloud backup is part of JoyoRogo Founder. It backs up your steps, heart rate, SpO2, sleep and
        workouts, including GPS tracks and the watch&apos;s Bluetooth address, to the JoyoFit cloud with
        your JoyoRogo account. Off until you sign in with a Founder account; after that it uploads on
        its own, starting with your whole history. While signed
        in, JoyoFit also exchanges meals, weight and daily scores with JoyoRogo. To delete cloud
        data, email dzulfikar@joyorogo.com (see fit.joyorogo.com/privasi). The app never reads from
        the cloud yet.
      </AppText>
      {!cloud.configured ? (
        <Notice tone="danger">
          This build has no cloud server URL. Deploy server/ and set EXPO_PUBLIC_JOYOFIT_CLOUD_URL,
          then rebuild.
        </Notice>
      ) : null}
      {cloud.signedIn && cloud.locked ? (
        <Notice
          icon="lock-closed"
          action={
            CAN_LINK_TO_FOUNDER
              ? { label: 'Become a Founder', onPress: () => void Linking.openURL(FOUNDER_URL) }
              : undefined
          }>
          {CAN_LINK_TO_FOUNDER
            ? 'Cloud backup is part of JoyoRogo Founder. This account is not Founder yet, so nothing is uploaded. Your data stays on this phone, and anything already in the cloud stays readable.'
            : 'Cloud backup is part of JoyoRogo Founder, which you can get in JoyoRogo. This account is not Founder yet, so nothing is uploaded. Your data stays on this phone, and anything already in the cloud stays readable.'}
        </Notice>
      ) : null}
      {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
      <KeyValue icon="person-circle" label="Account" value={cloud.signedIn ? cloud.email : null} />
      {cloud.signedIn ? (
        <>
          <KeyValue icon="time" label="Last cloud sync" value={cloud.lastSyncAt ? formatDateTime(cloud.lastSyncAt) : null} />
          <KeyValue icon="cloud-upload" label="Waiting to upload" value={cloud.pending == null ? null : `${formatCount(cloud.pending)} rows`} />
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
            disabled={cloud.uploading}
          />
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
    </Section>
  );
}

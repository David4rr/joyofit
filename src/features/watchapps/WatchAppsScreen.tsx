import * as Clipboard from 'expo-clipboard';
import { useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Details } from '@/components/Details';
import { Field } from '@/components/Input';
import { IconChip } from '@/components/IconChip';
import { isIos, IosUnavailable } from '@/components/IosUnavailable';
import { KeyValue } from '@/components/KeyValue';
import { Divider, Screen, Section } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import {
  FUEL_PACKAGE,
  fuelReach,
  groupFingerprint,
  installPercent,
  installStageText,
  paramsLine,
} from '@/features/watchapps/appModel';
import { useWatchApps } from '@/features/watchapps/useWatchApps';
import { formatDateTime } from '@/format';
import { radius, spacing, useColors } from '@/theme';
import type { FuelLinkStatus, WatchAppInfo } from '@/wear';

const SIGNING_NOTE =
  'A Huawei watch only runs apps that Huawei signed: a debug build whose signing profile lists this watch\'s UDID, or a release ' +
  'from AppGallery. An unsigned app is refused with status 103.';

/** Installs, lists and removes apps on the watch, and links the JoyoFit Fuel watch app. Android only. */
export function WatchAppsScreen() {
  if (isIos) {
    return (
      <Screen>
        <IosUnavailable
          title="Watch apps"
          icon="apps"
          reason="Installing watch apps and the JoyoFit Fuel link are not available on iOS yet: iOS has no app install and no Fuel link."
        />
      </Screen>
    );
  }
  return <WatchAppsContent />;
}

function ms(value: number | null): string | null {
  return value === null ? null : formatDateTime(value / 1000);
}

function WatchAppsContent() {
  const colors = useColors();
  const apps = useWatchApps();
  const { connected, list, busy, picked, progress, report } = apps;
  const [deleting, setDeleting] = useState<WatchAppInfo | null>(null);
  const [confirmUnsigned, setConfirmUnsigned] = useState(false);
  const idle = busy === null;
  const installing = busy === 'install';
  const runtime = paramsLine(list?.params ?? null);
  const percent = installPercent(progress, report);

  const startInstall = () => {
    if (!picked) return;
    if (picked.info.signed) void apps.install(false);
    else setConfirmUnsigned(true);
  };

  return (
    <Screen refresh={{ refreshing: busy === 'list', onRefresh: () => void apps.refresh(), enabled: connected && busy === null }}>
      <Section title="Apps on the watch" icon="apps">
        {runtime ? (
          <KeyValue label="Watch app runtime" value={runtime} icon="hardware-chip" />
        ) : (
          <AppText variant="caption" muted>
            {connected
              ? busy === 'list'
                ? 'Reading the watch...'
                : 'The watch gave no app runtime parameters.'
              : 'Connect your watch to see its apps.'}
          </AppText>
        )}
        <Details title="Which apps does the watch accept?">{SIGNING_NOTE}</Details>
        {apps.error ? <Notice tone="danger">{apps.error}</Notice> : null}
        {apps.notice ? <Notice icon="checkmark-circle">{apps.notice}</Notice> : null}
        {!connected ? (
          <EmptyState icon="watch" title="Watch not connected" description="The apps on your watch appear here once it is connected." />
        ) : list === null && busy === 'list' ? (
          <Skeleton width="100%" height={56} />
        ) : list === null ? (
          <EmptyState
            icon="apps"
            title="Apps not read yet"
            description="Read the list from your watch to see its apps."
            action={{ label: 'Read from the watch', icon: 'refresh', onPress: () => void apps.refresh() }}
          />
        ) : list.apps.length === 0 ? (
          <EmptyState icon="apps" title="No apps" description="The watch lists no installed apps. Install one from a file below." />
        ) : (
          list.apps.map((app, index) => {
            const working = typeof busy === 'object' && busy !== null && busy.packageName === app.packageName;
            return (
              <View key={app.packageName} style={styles.stack}>
                {index > 0 ? <Divider /> : null}
                <View style={styles.row}>
                  <IconChip icon="apps" />
                  <View style={styles.rowText}>
                    <AppText variant="bodyStrong" numberOfLines={2}>
                      {app.name}
                    </AppText>
                    <AppText variant="caption" muted selectable>
                      {app.packageName} · v{app.version}
                    </AppText>
                  </View>
                </View>
                <Button
                  label="Delete"
                  icon="trash"
                  variant="destructive"
                  disabled={!idle}
                  loading={working}
                  onPress={() => setDeleting(app)}
                />
              </View>
            );
          })
        )}
      </Section>

      <Section title="Install from file" icon="download">
        <AppText variant="caption" muted>
          Pick the signed Lite Wearable build from DevEco Studio (entry-bin-debug-lite-signed.hap) or a .bin file. JoyoFit reads it first and
          shows what it is.
        </AppText>
        <Button label="Choose app file" icon="document" disabled={!connected || !idle} onPress={() => void apps.pick()} />
        {picked ? (
          <View style={styles.stack}>
            <View style={styles.row}>
              {picked.info.iconBase64 ? (
                <Image
                  accessibilityIgnoresInvertColors
                  source={{ uri: `data:image/png;base64,${picked.info.iconBase64}` }}
                  style={styles.icon}
                />
              ) : (
                <IconChip icon="apps" size="lg" />
              )}
              <View style={styles.rowText}>
                <AppText variant="bodyStrong" numberOfLines={2}>
                  {picked.info.bundleName ?? picked.info.packageName}
                </AppText>
                <AppText variant="caption" muted>
                  {picked.info.version ? `v${picked.info.version}` : 'no version'}
                  {picked.info.vendor ? ` · ${picked.info.vendor}` : ''}
                  {` · ${Math.round(picked.info.bytes / 1024)} KB`}
                </AppText>
                <AppText variant="caption" muted selectable>
                  {picked.info.packageName}
                </AppText>
                <AppText variant="caption" color={picked.info.signed ? colors.foreground : colors.destructive}>
                  {picked.info.signed ? 'Signed (hw signed app)' : 'Not signed'}
                </AppText>
              </View>
            </View>
            {picked.info.unwrappedFrom ? (
              <AppText variant="caption" muted>
                Taken from {picked.info.unwrappedFrom} inside the zip.
              </AppText>
            ) : null}
            {!picked.info.signed ? (
              <Notice tone="danger">
                This file carries no Huawei signature. The watch will most likely refuse it. {SIGNING_NOTE}
              </Notice>
            ) : null}
            <Button
              label={picked.info.signed ? 'Install on the watch' : 'Install anyway'}
              icon="cloud-upload"
              variant="primary"
              disabled={!connected || !idle}
              loading={installing}
              onPress={startInstall}
            />
            <Button label="Choose another file" variant="ghost" disabled={!idle} onPress={apps.clearPicked} />
          </View>
        ) : null}
        {installing ? (
          <View style={styles.stack}>
            <View
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: 100, now: percent }}
              style={[styles.track, { backgroundColor: colors.muted }]}>
              <View style={[styles.bar, { backgroundColor: colors.primary, width: `${percent}%` }]} />
            </View>
            <AppText variant="caption" muted>
              {installStageText(progress, report)}
            </AppText>
          </View>
        ) : null}
      </Section>

      <FuelSection
        link={apps.fuel}
        installedVersion={apps.fuelInstalled?.version ?? null}
        listKnown={list !== null}
        busy={busy === 'fuel'}
        idle={idle}
        error={apps.fuelError}
        notice={apps.fuelNotice}
        onSend={() => void apps.sendProfile()}
        onSaveFingerprint={(fingerprint) => void apps.saveFingerprint(fingerprint)}
      />

      <ConfirmDialog
        visible={deleting !== null}
        title="Delete app"
        message={deleting ? `Delete "${deleting.name}" from the watch? The watch reports when it is gone.` : ''}
        confirmLabel="Delete"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          const target = deleting;
          setDeleting(null);
          if (target) void apps.remove(target.packageName);
        }}
      />
      <ConfirmDialog
        visible={confirmUnsigned}
        title="Send an unsigned app?"
        message="This app has no Huawei signature, so the watch will most likely refuse it with status 103. Send it anyway?"
        confirmLabel="Send anyway"
        onCancel={() => setConfirmUnsigned(false)}
        onConfirm={() => {
          setConfirmUnsigned(false);
          void apps.install(true);
        }}
      />
    </Screen>
  );
}

interface FuelSectionProps {
  link: FuelLinkStatus | null;
  installedVersion: string | null;
  listKnown: boolean;
  busy: boolean;
  idle: boolean;
  error: string | null;
  notice: string | null;
  onSend: () => void;
  onSaveFingerprint: (fingerprint: string) => void;
}

/** The link to the JoyoFit Fuel watch app: whether it is there, whether it answers, and the numbers it computes with. */
function FuelSection({ link, installedVersion, listKnown, busy, idle, error, notice, onSend, onSaveFingerprint }: FuelSectionProps) {
  /** What the user typed since the last save; null shows the saved value, so a fingerprint the native side changes shows up. */
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const saved = link?.watchFingerprint ?? '';
  const value = draft ?? saved;

  const reach = fuelReach(link);
  const phoneFingerprint = link?.phoneFingerprint ?? null;
  const profile = link?.profile ?? null;

  const copy = async () => {
    if (!phoneFingerprint) return;
    await Clipboard.setStringAsync(phoneFingerprint);
    setCopied(true);
  };

  return (
    <Section title="JoyoFit Fuel" icon="flame" tint="workouts">
      <AppText variant="caption" muted>
        A watch app that shows kcal, fat and carbs from your heart rate during a workout. JoyoFit sends it your weight, age, sex and heart
        rates. It is not verified on a watch yet.
      </AppText>
      <KeyValue
        label="On the watch"
        icon="watch"
        value={installedVersion ? `Installed, v${installedVersion}` : listKnown ? `Not in the app list (${FUEL_PACKAGE})` : null}
      />
      <KeyValue
        label="Answers the ping"
        icon="pulse"
        value={
          reach === 'reachable'
            ? 'Yes'
            : reach === 'silent'
              ? `No, the watch answered 0x${(link?.pingCode ?? 0).toString(16)}`
              : link?.available
                ? 'No answer yet'
                : 'Needs a connected watch'
        }
      />
      <KeyValue
        label="Last hello"
        icon="hand-left"
        value={ms(link?.lastHelloAt ?? null) ? `${ms(link?.lastHelloAt ?? null)} (v${link?.lastHelloVersion ?? '?'})` : null}
      />
      <KeyValue label="Profile sent" icon="send" value={ms(link?.lastProfileSentAt ?? null)} />
      <KeyValue label="Profile stored by the watch" icon="checkmark-done" value={ms(link?.lastAckAt ?? null)} />
      {profile ? (
        <AppText variant="caption" muted>
          Profile it gets: {profile.weightKg} kg, age {profile.age}, {profile.sex}, max heart rate {profile.maxHr}, resting{' '}
          {profile.restHr ?? 'unknown'}.
        </AppText>
      ) : null}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {notice ? <Notice icon="checkmark-circle">{notice}</Notice> : null}
      <Button label="Send profile now" icon="send" disabled={!link?.available || !idle} loading={busy} onPress={onSend} />

      <Divider />
      <AppText variant="label" muted>
        Phone fingerprint
      </AppText>
      {phoneFingerprint ? (
        <>
          <AppText variant="mono" selectable>
            {groupFingerprint(phoneFingerprint)}
          </AppText>
          <Button label={copied ? 'Copied' : 'Copy fingerprint'} icon="copy" onPress={() => void copy()} />
        </>
      ) : (
        <Notice tone="danger">JoyoFit could not read its own signing certificate, so it has no fingerprint to show.</Notice>
      )}
      <AppText variant="caption" muted>
        SHA-256 of the certificate this app is signed with. The watch app has it as PEER_FINGERPRINT.
      </AppText>

      <Field
        label="Watch app fingerprint"
        hint="Empty sends the bundle name instead. Whether the watch checks it is not known yet."
        value={value}
        onChangeText={setDraft}
        autoCapitalize="none"
        autoCorrect={false}
        placeholder={FUEL_PACKAGE}
      />
      <Button
        label="Save fingerprint"
        disabled={value.trim() === saved}
        onPress={() => {
          onSaveFingerprint(value);
          setDraft(null);
        }}
      />

      <Details title="Build and sign the watch app">
        watchapp/fuel/README.md in the JoyoFit repository explains how to build the app in DevEco Studio and sign it for your watch. The
        watch only installs it when Huawei signed it for that watch.
      </Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  rowText: { flex: 1, gap: 2 },
  icon: { width: 48, height: 48, borderRadius: 10 },
  track: { height: 8, borderRadius: radius.pill, overflow: 'hidden' },
  bar: { height: 8, borderRadius: radius.pill },
});

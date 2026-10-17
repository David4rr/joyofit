import { useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { NavRow } from '@/components/NavRow';
import { Divider, Screen, Section } from '@/components/Screen';
import { isIos } from '@/components/IosUnavailable';
import { AvailableWatchesSection } from '@/features/device/AvailableWatchesSection';
import { BindConfirmDialog } from '@/features/device/BindConfirmDialog';
import { FindWatchSection } from '@/features/device/FindWatchSection';
import { GuideLink } from '@/features/device/GuideLink';
import { SUPPORT_LABEL } from '@/features/device/modelSupport';
import { SupportReportSection } from '@/features/device/SupportReportSection';
import { WatchStatusCard } from '@/features/device/WatchStatusCard';
import { useBluetoothPermission } from '@/features/device/useBluetoothPermission';
import { useBondedDevices } from '@/features/device/useBondedDevices';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useTheme } from '@/theme';

const CONNECT_STEPS = isIos
  ? [
      'Keep the watch close to the iPhone with Bluetooth on. If it is still connected to another phone, disconnect it there first. It shows up in the list below.',
      'Unbind it from Huawei Health first, or the watch will refuse this app.',
      'On the first connect, keep the watch awake, accept the prompt on its screen, then tap Pair on the iPhone.',
    ]
  : [
      'Unbind the watch from Huawei Health first, or the watch will refuse this app.',
      'Pair it in Android Bluetooth settings, or tap "Scan nearby devices" below to find it.',
      'On the first connect, keep the watch awake and accept the prompt on its screen.',
    ];

/** The three things that have to be true before the first connect, in the order they happen. */
function ConnectSteps() {
  const { colors, fonts } = useTheme();
  return (
    <Section title="Before you connect" icon="list">
      <Details title="3 steps before the first connect">
        {CONNECT_STEPS.map((step, index) => (
          <View key={step} style={styles.step}>
            <View style={[styles.stepNumber, { backgroundColor: colors.muted }]}>
              <AppText variant="label" style={[styles.stepDigit, { fontFamily: fonts.bold }]}>
                {index + 1}
              </AppText>
            </View>
            <AppText variant="caption" style={styles.stepText}>
              {step}
            </AppText>
          </View>
        ))}
      </Details>
      <GuideLink />
    </Section>
  );
}

export default function WatchScreen() {
  const router = useRouter();
  const watch = useWatch();
  const permission = useBluetoothPermission();
  const granted = permission.status === 'granted';
  const bonded = useBondedDevices(granted);
  const { device } = watch;
  const linked = watch.linkState === 'connected' || watch.linkState === 'syncing';
  const pairedWatches = <AvailableWatchesSection permission={permission} bonded={bonded} />;

  const watchDetails = device ? (
    <Section title="Watch details" icon="watch">
      <View style={styles.grid}>
        <Pair label="Name" value={device.name} />
        <Pair label="Model" value={device.model ?? device.productModel} />
        <Pair label="Support" value={SUPPORT_LABEL[device.support]} />
        {device.model ? <Pair label="Product code" value={device.productModel} /> : null}
        <Pair label="Software" value={device.softwareVersion} />
        <Pair label="Hardware" value={device.hardwareVersion} />
        <Pair label="Serial" value={device.serialNumber} />
        <Pair label="Auth mode" value={device.authMode} />
        <Pair label="Battery" value={watch.battery === null ? null : `${watch.battery}%`} />
      </View>
      {watch.linkState !== 'connected' ? (
        <AppText variant="caption" muted>
          {watch.linkState === 'syncing' ? 'Available when the sync finishes.' : 'Connect your watch first.'}
        </AppText>
      ) : null}
      <Button
        label="Refresh battery"
        icon="refresh"
        disabled={watch.linkState !== 'connected'}
        onPress={() => void watch.refreshBattery()}
      />
    </Section>
  ) : null;

  const onTheWatch = (
    <Section title="On the watch" icon="watch">
      <NavRow
        icon="color-palette"
        title="Watch faces"
        subtitle="Switch, delete, install"
        style={styles.navRow}
        onPress={() => router.push('/watch/faces')}
      />
      <Divider />
      <NavRow
        icon="apps"
        title="Watch apps"
        subtitle="Install, delete, JoyoFit Fuel"
        style={styles.navRow}
        onPress={() => router.push('/watch/apps')}
      />
      <Divider />
      <NavRow
        icon="images"
        title="Photo face"
        subtitle="Your photos on the watch"
        style={styles.navRow}
        onPress={() => router.push('/watch/photos')}
      />
      <Divider />
      <NavRow
        icon="alarm"
        title="Alarms"
        subtitle="Read and change"
        style={styles.navRow}
        onPress={() => router.push('/watch/alarms')}
      />
    </Section>
  );

  return (
    <Screen
      title="Watch"
      refresh={{ refreshing: bonded.loading, onRefresh: () => void bonded.refresh(), enabled: granted }}>
      <WatchStatusCard />
      {/* Connected, the list is only needed to disconnect or switch, so the watch's own pages come first. */}
      {linked ? (
        <>
          {onTheWatch}
          <FindWatchSection />
          {watchDetails}
          {pairedWatches}
          <SupportReportSection />
        </>
      ) : (
        <>
          {device ? null : <ConnectSteps />}
          {pairedWatches}
          {watchDetails}
          {device ? <FindWatchSection /> : null}
          {onTheWatch}
          <SupportReportSection />
        </>
      )}
      {device ? <ConnectSteps /> : null}
      <BindConfirmDialog />
    </Screen>
  );
}

function Pair({ label, value }: { label: string; value: string | null }) {
  return (
    <View style={styles.pair}>
      <AppText variant="caption" muted>
        {label}
      </AppText>
      <AppText variant="label" selectable numberOfLines={1}>
        {value ?? '\u2014'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: spacing.sm, columnGap: spacing.md },
  pair: { width: '47%' },
  navRow: { paddingHorizontal: 0 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepDigit: { fontVariant: ['tabular-nums'] },
  stepText: { flex: 1, paddingTop: 6 },
});

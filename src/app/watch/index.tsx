import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { NavRow } from '@/components/NavRow';
import { Divider, Screen, Section } from '@/components/Screen';
import { isIos } from '@/components/IosUnavailable';
import { EmptyState, LoadingState, Notice } from '@/components/States';
import { BondedRow } from '@/features/device/BondedRow';
import { FindWatchSection } from '@/features/device/FindWatchSection';
import { GuideLink } from '@/features/device/GuideLink';
import { SUPPORT_LABEL, supportRank } from '@/features/device/modelSupport';
import { SupportReportSection } from '@/features/device/SupportReportSection';
import { WatchStatusCard } from '@/features/device/WatchStatusCard';
import { NO_WATCH_FOUND_HINT, NO_WATCH_FOUND_SCAN_HINT } from '@/features/device/connectFailure';
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

/** Paired watches shown before the list scrolls inside its card. */
const VISIBLE_BONDED = 3;

export default function WatchScreen() {
  const router = useRouter();
  const watch = useWatch();
  const permission = useBluetoothPermission();
  const granted = permission.status === 'granted';
  const bonded = useBondedDevices(granted);
  const { device } = watch;
  // Measured row heights, so the list shows exactly VISIBLE_BONDED rows before it scrolls.
  const [rowHeights, setRowHeights] = useState<Record<string, number>>({});

  const linked = watch.linkState === 'connected' || watch.linkState === 'syncing';
  // iOS only: every listed watch is out of reach (a watch linked to another phone does not advertise). Android leaves `nearby` unset.
  const showNotInReach =
    bonded.loaded && !bonded.loading && !bonded.error && !linked && bonded.devices.length > 0 && bonded.devices.every((d) => d.nearby === false);

  // The watch in use first, then the ones this app can talk to best.
  const devices = useMemo(() => {
    const list = [...bonded.devices];
    if (watch.activeAddress && !list.some((d) => d.address === watch.activeAddress)) {
      list.unshift({
        address: watch.activeAddress,
        name: watch.device?.name || watch.activeAddress,
        model: watch.device?.model ?? null,
        support: watch.device?.support ?? 'tested',
        reason: null,
      });
    }
    return list.sort(
      (a, b) =>
        Number(b.address === watch.activeAddress) - Number(a.address === watch.activeAddress) ||
        supportRank(a.support) - supportRank(b.support),
    );
  }, [bonded.devices, watch.activeAddress, watch.device]);

  const showEmpty = devices.length === 0 && !bonded.loading && !bonded.error;
  const listMaxHeight = useMemo(() => {
    if (devices.length <= VISIBLE_BONDED) return undefined;
    const heights = devices.slice(0, VISIBLE_BONDED).map((d) => rowHeights[d.address]);
    return heights.every((h) => h !== undefined) ? heights.reduce((sum, h) => sum + h, 0) : undefined;
  }, [devices, rowHeights]);

  const pairedWatches = (
    <Section
      title={bonded.scanning ? 'Searching for devices...' : 'Available watches'}
      icon="bluetooth"
      trailing={
        bonded.scanning ? (
          <AppText variant="caption" muted>
            Scanning...
          </AppText>
        ) : devices.length > 0 ? (
          <AppText variant="caption" muted>
            {devices.length}
          </AppText>
        ) : null
      }>
      {permission.status === 'checking' ? (
        <LoadingState label="Checking Bluetooth permission" />
      ) : !granted ? (
        <>
          <Notice tone="danger">Bluetooth permission is needed to list paired watches and open the connection.</Notice>
          {permission.status === 'blocked' ? (
            <Button label="Open app settings" icon="settings" onPress={() => void Linking.openSettings()} />
          ) : (
            <Button label="Continue" variant="primary" icon="bluetooth" onPress={() => void permission.request()} />
          )}
        </>
      ) : (
        <>
          {bonded.error ? <Notice tone="danger">Could not read paired devices: {bonded.error}</Notice> : null}
          {showNotInReach ? (
            <Notice action={{ label: 'Refresh', onPress: () => void bonded.refresh() }}>{NO_WATCH_FOUND_HINT}</Notice>
          ) : null}
          {!isIos && !bonded.scanning && bonded.scanFound === 0 && !linked ? (
            <Notice action={{ label: 'Scan again', onPress: () => void bonded.startScan() }}>{NO_WATCH_FOUND_SCAN_HINT}</Notice>
          ) : null}
          {showEmpty ? (
            <EmptyState
              icon="bluetooth"
              title={isIos ? 'No paired devices' : bonded.scanning ? 'Scanning for devices...' : 'No devices found'}
              description={
                isIos
                  ? NO_WATCH_FOUND_HINT
                  : bonded.scanning
                    ? 'Looking for nearby Huawei and Honor watches or bands. Make sure your device is ready to connect.'
                    : 'Pair the watch in Android Bluetooth settings, or tap Scan nearby devices.'
              }
              action={
                isIos
                  ? { label: 'Refresh list', icon: 'refresh', onPress: () => void bonded.refresh() }
                  : {
                      label: bonded.scanning ? 'Scanning...' : 'Scan nearby devices',
                      icon: 'refresh',
                      onPress: () => {
                        void bonded.reload();
                        void bonded.startScan();
                      },
                    }
              }
            />
          ) : (
            <>
              <ScrollView
                style={listMaxHeight === undefined ? undefined : { maxHeight: listMaxHeight }}
                scrollEnabled={listMaxHeight !== undefined}
                nestedScrollEnabled
                showsVerticalScrollIndicator>
                {devices.map((d, index) => (
                  <View
                    key={d.address}
                    style={[styles.bonded, index > 0 && styles.bondedNext]}
                    onLayout={(e) => {
                      const height = e.nativeEvent.layout.height;
                      setRowHeights((prev) => (prev[d.address] === height ? prev : { ...prev, [d.address]: height }));
                    }}>
                    {index > 0 ? <Divider /> : null}
                    <BondedRow
                      device={d}
                      linkState={watch.linkState}
                      activeAddress={watch.activeAddress}
                      onConnect={(address) => {
                        void bonded.stopScan();
                        void watch.connect(address);
                      }}
                      onDisconnect={() => void watch.disconnect()}
                      onForget={(address) => {
                        void watch.forget(address).then(() => void bonded.reload());
                      }}
                    />
                  </View>
                ))}
              </ScrollView>
              {isIos ? (
                <Button label="Refresh list" icon="refresh" loading={bonded.loading} onPress={() => void bonded.refresh()} />
              ) : (
                <Button
                  label={bonded.scanning ? 'Stop scanning' : linked ? 'Scan for other devices' : 'Scan nearby devices'}
                  icon={bonded.scanning ? 'close' : 'refresh'}
                  loading={bonded.loading}
                  onPress={() => {
                    if (bonded.scanning) {
                      void bonded.stopScan();
                    } else {
                      void bonded.reload();
                      void bonded.startScan();
                    }
                  }}
                />
              )}
            </>
          )}
        </>
      )}
    </Section>
  );

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
      <ConfirmDialog
        visible={watch.bindRequest !== null}
        title="Pair this watch with this phone?"
        message={
          `This watch is not paired with this ${isIos ? 'iPhone' : 'phone'} yet. A watch keeps one phone pairing, so continuing replaces ` +
          'the pairing with your other phone or app (Huawei Health, or JoyoFit on another phone), which will have to pair again. ' +
          'You will then confirm on the watch.'
        }
        confirmLabel="Continue"
        onConfirm={() => void watch.confirmBind()}
        onCancel={watch.cancelBind}
      />
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
  bonded: { gap: spacing.md },
  bondedNext: { paddingTop: spacing.md },
  navRow: { paddingHorizontal: 0 },
  step: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  stepNumber: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  stepDigit: { fontVariant: ['tabular-nums'] },
  stepText: { flex: 1, paddingTop: 6 },
});

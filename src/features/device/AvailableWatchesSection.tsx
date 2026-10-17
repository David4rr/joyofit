import { useMemo, useState } from 'react';
import { Linking, ScrollView, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { isIos } from '@/components/IosUnavailable';
import { Divider, Section } from '@/components/Screen';
import { EmptyState, LoadingState, Notice } from '@/components/States';
import { BondedRow } from '@/features/device/BondedRow';
import { NO_WATCH_FOUND_HINT, NO_WATCH_FOUND_SCAN_HINT } from '@/features/device/connectFailure';
import { supportRank } from '@/features/device/modelSupport';
import type { BluetoothPermission } from '@/features/device/useBluetoothPermission';
import type { BondedDevices } from '@/features/device/useBondedDevices';
import { useWatch } from '@/state/WatchProvider';
import { spacing } from '@/theme';

/** Paired watches shown before the list scrolls inside its card. */
const VISIBLE_BONDED = 3;

interface AvailableWatchesSectionProps {
  permission: BluetoothPermission;
  bonded: BondedDevices;
}

/**
 * The list of watches with the Bluetooth permission step, the scan and the connect, forget and disconnect buttons. The Watch tab and
 * the setup guide both show it, each owning the permission and device hooks (the tab feeds them to pull-to-refresh).
 */
export function AvailableWatchesSection({ permission, bonded }: AvailableWatchesSectionProps) {
  const watch = useWatch();
  const granted = permission.status === 'granted';
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

  return (
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
}

const styles = StyleSheet.create({
  bonded: { gap: spacing.md },
  bondedNext: { paddingTop: spacing.md },
});

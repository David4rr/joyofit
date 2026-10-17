import { useCallback, useState } from 'react';
import { Linking, PermissionsAndroid, Platform, StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Details } from '@/components/Details';
import { Input } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { Pair, PairGrid } from '@/features/settings/PairGrid';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { errorMessage, formatClock } from '@/format';
import { spacing } from '@/theme';
import {
  HuaweiWear,
  type TemperatureUnit,
  type WeatherLocationMode,
  type WeatherStatus,
} from '@/wear';

const UNITS: readonly { value: TemperatureUnit; label: string }[] = [
  { value: 'celsius', label: '\u00B0C' },
  { value: 'fahrenheit', label: '\u00B0F' },
];

const MODES: readonly { value: WeatherLocationMode; label: string }[] = [
  { value: 'current', label: 'This phone' },
  { value: 'city', label: 'A city' },
];

const INTERVALS: readonly { value: number; label: string }[] = [
  { value: 30, label: '30 min' },
  { value: 60, label: '1 h' },
  { value: 120, label: '2 h' },
  { value: 240, label: '4 h' },
];

const LOCATION_DENIED_ANDROID =
  'Location denied: weather for this phone cannot be fetched. Allow it, or choose a city.';
const LOCATION_DENIED_IOS =
  'Location is off for JoyoFit. Turn it on in Settings > JoyoFit > Location (While Using the App), or choose a city.';

/**
 * Asks for the coarse location; true when granted. The native side also accepts the fine one.
 * Android only: on iOS the native module shows the system prompt itself, once, when the weather
 * switch or "This phone" is set (`setWeatherEnabled`, `setWeatherLocationMode`).
 */
async function ensureCoarseLocation(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  const permission = PermissionsAndroid.PERMISSIONS.ACCESS_COARSE_LOCATION;
  if (await PermissionsAndroid.check(permission)) return true;
  return (await PermissionsAndroid.request(permission)) === PermissionsAndroid.RESULTS.GRANTED;
}

/** "Sunny" from the Huawei icon name `SUNNY`, "Light rain" from `LIGHT_RAIN`. */
function conditionLabel(icon: string): string {
  const text = icon.toLowerCase().replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function WeatherSection() {
  const [status, setStatus] = useState<WeatherStatus>(() => HuaweiWear.getWeatherStatus());
  const [city, setCity] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; danger: boolean } | null>(null);
  /** iOS asks only once: after a refusal the only way to allow location is the Settings app. */
  const [needsSettings, setNeedsSettings] = useState(false);

  const refresh = useCallback(() => setStatus(HuaweiWear.getWeatherStatus()), []);
  useNativeRefresh(refresh);

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (done) setMessage({ text: done, danger: false });
    } catch (e) {
      setMessage({ text: errorMessage(e), danger: true });
    } finally {
      setBusy(false);
      refresh();
    }
  };

  /** Selecting or enabling `current` needs the permission; without it the watch is told so. */
  const askLocation = async () => {
    if (Platform.OS === 'ios') return;
    if (!(await ensureCoarseLocation())) {
      setMessage({ text: LOCATION_DENIED_ANDROID, danger: true });
    }
  };

  /** iOS: the native call above has shown the prompt (if it was due); say so when location is still off. */
  const reportIosDenial = () => {
    if (Platform.OS !== 'ios' || HuaweiWear.getWeatherStatus().locationPermission) return;
    setNeedsSettings(true);
    setMessage({ text: LOCATION_DENIED_IOS, danger: true });
  };

  const toggle = (enabled: boolean) =>
    run(async () => {
      if (enabled && status.locationMode === 'current') await askLocation();
      await HuaweiWear.setWeatherEnabled(enabled);
      if (enabled && status.locationMode === 'current') reportIosDenial();
    });

  const chooseMode = (mode: WeatherLocationMode) =>
    run(async () => {
      if (mode === 'current') await askLocation();
      await HuaweiWear.setWeatherLocationMode(mode);
      if (mode === 'current') reportIosDenial();
    });

  const allowLocation = () =>
    run(async () => {
      if (Platform.OS === 'ios') {
        if (needsSettings) {
          await Linking.openSettings();
          return;
        }
        await HuaweiWear.setWeatherLocationMode('current');
        reportIosDenial();
        return;
      }
      await askLocation();
    });

  const search = () =>
    run(async () => {
      const place = await HuaweiWear.setWeatherCity(city);
      setCity('');
      setMessage({
        text: `City set to ${place.name}${place.detail ? ` (${place.detail})` : ''}.`,
        danger: false,
      });
    });

  const connected = status.watchSupported !== null;

  return (
    <Section title="Weather" icon="partly-sunny">
      <SwitchRow
        icon="partly-sunny"
        label="Send weather to the watch"
        value={status.enabled}
        onValueChange={toggle}
        disabled={busy}
      />

      <View style={styles.row}>
        <View style={styles.unit}>
          <AppText variant="label" muted>
            Unit
          </AppText>
          <Segmented
            options={UNITS}
            value={status.unit}
            onChange={(unit) => run(() => HuaweiWear.setWeatherUnit(unit))}
            disabled={busy}
          />
        </View>
        <View style={styles.mode}>
          <AppText variant="label" muted>
            Weather for
          </AppText>
          <Segmented options={MODES} value={status.locationMode} onChange={chooseMode} disabled={busy} />
        </View>
      </View>

      {status.locationMode === 'current' ? (
        <>
          <PairGrid>
            <Pair label="Location permission" value={status.locationPermission ? 'Granted' : 'Not granted'} />
          </PairGrid>
          {!status.locationPermission ? (
            <Button
              label={Platform.OS === 'ios' && needsSettings ? 'Open Settings' : 'Allow location'}
              variant="secondary"
              icon="location-outline"
              onPress={allowLocation}
              disabled={busy}
            />
          ) : null}
        </>
      ) : (
        <>
          <PairGrid>
            <Pair
              label="City"
              value={
                status.city
                  ? `${status.city.name}${status.city.detail ? `, ${status.city.detail}` : ''}`
                  : null
              }
              wide
            />
          </PairGrid>
          <Input
            icon="search"
            accessibilityLabel="City name"
            placeholder="City, or City, Country"
            value={city}
            onChangeText={setCity}
            onSubmitEditing={search}
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
          />
          <Button label="Search city" variant="secondary" onPress={search} disabled={busy || !city.trim()} />
        </>
      )}

      <AppText variant="label" muted>
        Update interval
      </AppText>
      <Segmented
        options={INTERVALS}
        value={status.intervalMinutes}
        onChange={(minutes) => run(() => HuaweiWear.setWeatherIntervalMinutes(minutes))}
        disabled={busy}
      />

      {message ? <Notice tone={message.danger ? 'danger' : 'info'}>{message.text}</Notice> : null}
      {!connected ? (
        <Notice>Connect the watch to send weather.</Notice>
      ) : status.watchSupported === false ? (
        <Notice tone="danger">This watch does not list the weather service.</Notice>
      ) : null}
      <Button
        label="Update now"
        variant="primary"
        icon="refresh"
        loading={busy}
        disabled={!status.enabled || !connected}
        onPress={() => run(async () => void (await HuaweiWear.refreshWeather()), 'Sent to the watch.')}
      />
      <PairGrid>
        <Pair label="Last sent" value={status.lastPushAt ? formatClock(status.lastPushAt) : null} />
        <Pair
          label="Last weather"
          value={
            status.lastTemperatureC !== null && status.lastCondition
              ? `${status.lastTemperatureC}\u00B0C, ${conditionLabel(status.lastCondition)}${
                  status.lastLocationName ? `, ${status.lastLocationName}` : ''
                }`
              : null
          }
        />
      </PairGrid>
      {status.lastError ? <Notice tone="danger">{status.lastError}</Notice> : null}
      <Details>
        {"Sends current weather and a forecast, on every connect and at the chosen interval. Data comes from Open-Meteo; only coordinates rounded to about 1 km go out.\n\n" +
          (Platform.OS === 'ios'
            ? 'This phone: uses your approximate location while the app is open. When the watch asks in the background, iOS gives the app no fresh position, so the last one is reused.'
            : 'This phone: uses the last known coarse location. In the background Android may not give a fresh one, so the last position is reused.')}
      </Details>
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md },
  unit: { flex: 1, gap: spacing.xs },
  mode: { flex: 2, gap: spacing.xs },
});

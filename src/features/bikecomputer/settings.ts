/**
 * Bike computer settings and page layout in the key-value store: read synchronously (the ride screen needs them on its first frame),
 * written on every change, with a subscription for `useSyncExternalStore`. The model and repair rules are in `settingsModel.ts`.
 */
import Storage from 'expo-sqlite/kv-store';

import { normalizeLayout } from './fields/layout';
import { DEFAULT_BIKE_SETTINGS, mergeSettings, sanitizeSettings } from './settingsModel';
import type { BikeLayout, BikeSettings } from './types';

export { DEFAULT_BIKE_SETTINGS } from './settingsModel';

const SETTINGS_KEY = 'joyofit.bike.settings';
const LAYOUT_KEY = 'joyofit.bike.layout';
const ROUTE_KEY = 'joyofit.bike.route';

function readJson(key: string): unknown {
  try {
    const text = Storage.getItemSync(key);
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    Storage.setItemSync(key, JSON.stringify(value));
  } catch {
    // The change still applies for this session.
  }
}

let settings: BikeSettings | null = null;
let layout: BikeLayout | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export const bikeSettingsStore = {
  get(): BikeSettings {
    settings ??= sanitizeSettings(readJson(SETTINGS_KEY) ?? DEFAULT_BIKE_SETTINGS);
    return settings;
  },
  set(patch: Partial<BikeSettings>): void {
    settings = mergeSettings(this.get(), patch);
    writeJson(SETTINGS_KEY, settings);
    emit();
  },
  getLayout(hasRoute = false): BikeLayout {
    layout ??= normalizeLayout(readJson(LAYOUT_KEY), hasRoute);
    return layout;
  },
  setLayout(next: BikeLayout): void {
    layout = normalizeLayout(next, false);
    writeJson(LAYOUT_KEY, layout);
    emit();
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The route (library id) the rider chose for the next ride; null for none. Kept so an app restart during a ride keeps following it. */
export const chosenRoute = {
  get(): string | null {
    const value = Storage.getItemSync(ROUTE_KEY);
    return value && value.length > 0 ? value : null;
  },
  set(id: string | null): void {
    if (id === null) Storage.removeItemSync(ROUTE_KEY);
    else Storage.setItemSync(ROUTE_KEY, id);
  },
};

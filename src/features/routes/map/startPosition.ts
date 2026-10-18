/**
 * Where the drawing map opens and what "Pusatkan ke lokasiku" can use, without ever showing a permission prompt: the
 * position comes from the OS only when the weather feature already got location access (`locationPermission`), else from the
 * weather city setting, else all of Indonesia.
 */
import type { LatLon } from '@/features/routes/map/geometry';
import { DEFAULT_CAMERA, PLACE_ZOOM } from '@/features/routes/map/mapConfig';
import type { MapLibre } from '@/features/routes/map/maplibre';
import { HuaweiWear } from '@/wear';

export interface StartView {
  lat: number;
  lon: number;
  zoom: number;
}

const LOCATION_TIMEOUT_MS = 3000;

/** Whether the app already holds location access; reading the weather status never asks for it. */
export function locationAllowed(): boolean {
  try {
    return HuaweiWear.getWeatherStatus().locationPermission;
  } catch {
    return false;
  }
}

/** The city the user chose for the weather, if any. */
function weatherCity(): LatLon | null {
  try {
    const city = HuaweiWear.getWeatherStatus().city;
    return city ? { lat: city.latitude, lon: city.longitude } : null;
  } catch {
    return null;
  }
}

/** The phone's last known position, or null when there is none, access is missing or the OS does not answer in time. */
export async function deviceLocation(maplibre: MapLibre): Promise<LatLon | null> {
  if (!locationAllowed()) return null;
  const { promise: timeout, resolve } = Promise.withResolvers<undefined>();
  const timer = setTimeout(() => resolve(undefined), LOCATION_TIMEOUT_MS);
  try {
    const position = await Promise.race([maplibre.LocationManager.getCurrentPosition(), timeout]);
    return position ? { lat: position.coords.latitude, lon: position.coords.longitude } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Device position, else the weather city, else Indonesia. */
export async function resolveStartView(maplibre: MapLibre): Promise<StartView> {
  const here = await deviceLocation(maplibre);
  if (here) return { ...here, zoom: PLACE_ZOOM };
  const city = weatherCity();
  if (city) return { ...city, zoom: PLACE_ZOOM - 3 };
  return DEFAULT_CAMERA;
}

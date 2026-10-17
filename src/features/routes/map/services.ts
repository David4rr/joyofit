/**
 * The network clients of the route map, built once with JoyoFit's identity. The public services (OSRM, Nominatim) ask for
 * a User-Agent that names the app and a way to reach it; the caches and the 1.1 s queues live as long as the app process.
 */
import Constants from 'expo-constants';

import { createGeocodeClient } from '@/features/routes/map/geocodeClient';
import { createRoutingClient } from '@/features/routes/map/routingClient';

const APP_URL = 'https://joyofit.app';

export const userAgent = `JoyoFit/${Constants.expoConfig?.version ?? '1.0'} (${APP_URL})`;

const identity = { userAgent, referer: APP_URL };

export const routing = createRoutingClient({ fetch, ...identity });
export const geocoder = createGeocodeClient({ fetch, ...identity });

/** Headers for the elevation request: Open-Meteo wants no key, a User-Agent is courtesy. */
export const elevationHeaders = { 'User-Agent': userAgent, Referer: APP_URL };

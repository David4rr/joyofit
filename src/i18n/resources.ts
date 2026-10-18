import idCommon from './locales/id/common.json';
import idToday from './locales/id/today.json';
import idHealth from './locales/id/health.json';
import idWorkouts from './locales/id/workouts.json';
import idSharing from './locales/id/sharing.json';
import idWatch from './locales/id/watch.json';
import idRoutes from './locales/id/routes.json';
import idFamily from './locales/id/family.json';
import idSocial from './locales/id/social.json';
import idOnboarding from './locales/id/onboarding.json';
import idSettings from './locales/id/settings.json';
import idGear from './locales/id/gear.json';
import enCommon from './locales/en/common.json';
import enToday from './locales/en/today.json';
import enHealth from './locales/en/health.json';
import enWorkouts from './locales/en/workouts.json';
import enSharing from './locales/en/sharing.json';
import enWatch from './locales/en/watch.json';
import enRoutes from './locales/en/routes.json';
import enFamily from './locales/en/family.json';
import enSocial from './locales/en/social.json';
import enOnboarding from './locales/en/onboarding.json';
import enSettings from './locales/en/settings.json';
import enGear from './locales/en/gear.json';

/** Indonesian is the source: its JSON shapes the key types. */
const id = {common: idCommon, today: idToday, health: idHealth, workouts: idWorkouts, sharing: idSharing, watch: idWatch, routes: idRoutes, family: idFamily, social: idSocial, onboarding: idOnboarding, settings: idSettings, gear: idGear};

/** English is typed as `typeof id`: tsc fails on a missing or extra key. */
const en: typeof id = {common: enCommon, today: enToday, health: enHealth, workouts: enWorkouts, sharing: enSharing, watch: enWatch, routes: enRoutes, family: enFamily, social: enSocial, onboarding: enOnboarding, settings: enSettings, gear: enGear};

export const resources = { id, en };
export type Resources = typeof id;
export const NAMESPACES = ['common', 'today', 'health', 'workouts', 'sharing', 'watch', 'routes', 'family', 'social', 'onboarding', 'settings', 'gear'] as const;
export type Namespace = (typeof NAMESPACES)[number];
export const DEFAULT_NAMESPACE = 'common' as const;

import type { PlayUpdates } from '@/features/updates/playTypes';

/** iOS: Play In-App Updates does not exist (TestFlight and the App Store notify on their own). Android resolves play.android.ts. */
export const playUpdates: PlayUpdates | null = null;

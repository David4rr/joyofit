import Constants from 'expo-constants';

/** Version and native build of this app; a different one is an app update (see `workoutFailures.ts`). */
export const APP_BUILD = `${Constants.expoConfig?.version ?? '0'}+${Constants.nativeBuildVersion ?? '0'}`;

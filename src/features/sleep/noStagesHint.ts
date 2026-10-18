import { t } from '@/i18n';
import type { HealthSensorsStatus } from '@/wear';

export interface NoStagesHint {
  text: string;
  /** The TruSleep switch in Settings is worth opening: the watch takes it and the answer can change. */
  openSettings: boolean;
}

/**
 * What to tell the user about a night the watch gave no stages for. Newer watches (HarmonyOS 5 and up, dictionary
 * sleep files) send the stages with TruSleep on. Older ones only report when you slept in the TruSleep files: Huawei
 * Health works the stages out on the phone, which JoyoFit does not do (Gadgetbridge: TruSleep "only the start and
 * end times of sleep are implemented"). Those watches track light and deep sleep themselves while TruSleep is off.
 */
export function noStagesHint(sensors: Pick<HealthSensorsStatus, 'truSleep' | 'supported'>): NoStagesHint {
  if (sensors.supported !== null && !sensors.supported.truSleep) {
    return {
      text: t('health:noStages.unsupported'),
      openSettings: false,
    };
  }
  if (!sensors.truSleep) {
    return { text: t('health:noStages.turnOn'), openSettings: true };
  }
  return {
    text: t('health:noStages.unknown'),
    openSettings: true,
  };
}

import { t } from '@/i18n';
import type { NightStage } from '@/features/sleep/nights';
import type { Colors } from '@/theme';

/** `asleep` is sleep the watch reported without stages; it is never called light. */
export function stageLabel(stage: NightStage): string {
  return t(`health:stage.${stage}`);
}

/** Stage names in the current language, read when indexed so nothing is frozen at import. */
export const STAGE_LABELS: Record<NightStage, string> = {
  get light() {
    return stageLabel('light');
  },
  get deep() {
    return stageLabel('deep');
  },
  get rem() {
    return stageLabel('rem');
  },
  get awake() {
    return stageLabel('awake');
  },
  get asleep() {
    return stageLabel('asleep');
  },
};

/** `asleep` (no stage from the watch) is drawn neutral so it never reads as a real stage. */
export function stageColor(stage: NightStage, colors: Colors): string {
  return {
    light: colors.stageLight,
    deep: colors.stageDeep,
    rem: colors.stageRem,
    awake: colors.stageAwake,
    asleep: colors.mutedForeground,
  }[stage];
}

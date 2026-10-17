import type { NightStage } from '@/features/sleep/nights';
import type { Colors } from '@/theme';

/** `asleep` is sleep the watch reported without stages; it is never called light. */
export const STAGE_LABELS: Record<NightStage, string> = {
  light: 'Light',
  deep: 'Deep',
  rem: 'REM',
  awake: 'Awake',
  asleep: 'Sleep (no stages)',
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

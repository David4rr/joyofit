import type { FamilyLimits } from '@/cloud/family';

/**
 * Whether one more person can be watched. `pro`: a free account is at its limit and Pro raises it (the offer is shown);
 * `full`: even Pro is at its limit. Before the limits are known there is nothing to refuse.
 */
export type Capacity = 'ok' | 'pro' | 'full';

export function watchCapacity(limits: FamilyLimits | null, watchingCount: number): Capacity {
  if (limits === null || watchingCount < limits.maxWatching) return 'ok';
  return limits.pro ? 'full' : 'pro';
}

/** Days of history the detail screen may show: the three ranges the Worker answers, cut to what the account keeps. */
export const HISTORY_RANGES = [7, 30, 90] as const;
export type HistoryRange = (typeof HISTORY_RANGES)[number];

/** The longest range inside `historyDays` (30 free, 90 Pro); 7 when the limits are unknown. */
export function allowedRange(limits: FamilyLimits | null, wanted: HistoryRange): HistoryRange {
  const days = limits?.historyDays ?? HISTORY_RANGES[0];
  return [...HISTORY_RANGES].reverse().find((range) => range <= wanted && range <= days) ?? HISTORY_RANGES[0];
}

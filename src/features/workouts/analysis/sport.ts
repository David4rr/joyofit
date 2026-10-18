import type { SportKind } from './types';

/** Sport kind from the watch's English sport name, falling back to the Gadgetbridge `ActivityKind` of the summary. */
export function sportKind(sportName: string, summaryKind?: string): SportKind {
  const text = `${sportName} ${summaryKind ?? ''}`;
  if (/swim|diving|apnea|scuba/i.test(sportName)) return 'swim';
  if (/walk|hik/i.test(sportName)) return 'walk';
  if (/run|trail/i.test(sportName)) return 'run';
  if (/cycl|spinning|bik|\bride\b/i.test(sportName)) return 'ride';
  if (/swim/i.test(text)) return 'swim';
  if (/walk|hik/i.test(text)) return 'walk';
  if (/run/i.test(text)) return 'run';
  if (/cycl|bik/i.test(text)) return 'ride';
  return 'other';
}

/** Kinds read as pace per km (and have best efforts). */
export function isFootKind(kind: SportKind): boolean {
  return kind === 'run' || kind === 'walk';
}

/** Kinds that carry a pace series: on foot and on wheels. */
export function hasPace(kind: SportKind): boolean {
  return kind === 'run' || kind === 'walk' || kind === 'ride';
}

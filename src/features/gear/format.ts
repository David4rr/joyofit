import { fmtInt, t } from '@/i18n';
import type { Gear } from './model';

/** "312 km": whole kilometres, as people say how far their shoes have gone. */
export function gearKm(distanceM: number): string {
  return t('common:units.km', { value: fmtInt(Math.round(distanceM / 1000)) });
}

/** The kind as a word ("Sepatu"), or the gear's own name for kind `other`: what a reminder calls the gear. */
export function gearWhat(gear: Pick<Gear, 'kind' | 'name'>): string {
  return gear.kind === 'other' ? gear.name : t(`gear:kinds.${gear.kind}`);
}

/** "Sepatu: Nike Pegasus 41 · 312 km" for the share card. */
export function gearShareLine(gear: Pick<Gear, 'kind' | 'name'>, distanceM: number): string {
  return t('gear:share.line', { kind: t(`gear:kinds.${gear.kind}`), name: gear.name, distance: gearKm(distanceM) });
}

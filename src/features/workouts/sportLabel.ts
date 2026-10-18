import { i18n, t } from '@/i18n';

/** `Swimming (Open water)` -> `swimming_open_water`: the key under `workouts:sport.*`. */
function sportKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * A workout's name in the app language. The database keeps the watch's English sport name (it also drives the sport kind
 * and similar-workout matching), so display code goes through here. FIT imports add the maker in parentheses
 * (`Run (Garmin)`), unknown watch types read `Workout (type 9)`; a name nobody translated is shown as stored.
 */
export function sportLabel(sportName: string): string {
  const known = `workouts:sport.${sportKey(sportName)}`;
  if (i18n.exists(known)) return t(known as 'workouts:sport.running');

  const unknownType = /^Workout \(type (\d+)\)$/.exec(sportName);
  if (unknownType) return t('workouts:sport.unknownType', { type: unknownType[1] });

  const branded = /^(.+?) \(([^()]+)\)$/.exec(sportName);
  if (branded) {
    const base = `workouts:sport.${sportKey(branded[1]!)}`;
    if (i18n.exists(base)) return t('workouts:sport.withBrand', { sport: t(base as 'workouts:sport.running'), brand: branded[2] });
  }
  return sportName;
}

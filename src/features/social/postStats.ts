import type { RogoPost, RogoWatchStats } from '@/cloud/rogo';
import { fmtDistance, fmtInt, fmtDuration, t } from '@/i18n';

const num = (value: number | string | null | undefined) => (typeof value === 'number' ? value : null);

/** The watch stats of a post JoyoFit made (`stats.source === 'joyofit'`); null for every other post. */
export function watchStats(post: RogoPost): RogoWatchStats | null {
  const stats = post.stats;
  if (stats?.source !== 'joyofit') return null;
  return {
    source: 'joyofit',
    distanceM: num(stats.distanceM),
    avgHr: num(stats.avgHr),
    maxHr: num(stats.maxHr),
    startedAt: num(stats.startedAt) ?? Date.parse(post.createdAt),
    hasDetail: stats.hasDetail === 1 ? 1 : 0,
  };
}

/** The figures a post card shows: duration and energy for any post, distance and heart rate for a watch post. */
export function postFigures(post: RogoPost): { label: string; value: string }[] {
  const watch = watchStats(post);
  const figures: { label: string; value: string }[] = [];
  if (post.durationMin !== null) figures.push({ label: t('social:post.figure.time'), value: fmtDuration(post.durationMin * 60) });
  if (watch?.distanceM) figures.push({ label: t('social:post.figure.distance'), value: fmtDistance(watch.distanceM) });
  if (post.kcal !== null) figures.push({ label: t('social:post.figure.energy'), value: `${fmtInt(post.kcal)} kcal` });
  if (watch?.avgHr) figures.push({ label: t('social:post.figure.avgHr'), value: `${watch.avgHr} bpm` });
  if (watch?.maxHr) figures.push({ label: t('social:post.figure.maxHr'), value: `${watch.maxHr} bpm` });
  return figures;
}

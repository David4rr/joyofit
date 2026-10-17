/** Where a number comes from, shown next to it: the watch measured it, or JoyoFit worked it out. */
export type Source = 'watch' | 'estimate';

export function sourceLabel(source: Source): string {
  return source === 'watch' ? 'dari jam' : 'perkiraan';
}

/** `1 j 05 m` for 3900 s; `45 m` under an hour. */
export function formatHm(totalSec: number): string {
  const min = Math.round(totalSec / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h === 0 ? `${m} m` : `${h} j ${String(m).padStart(2, '0')} m`;
}

/** Recovery left: `Sudah pulih` at under half an hour, else whole hours (`14 j`). */
export function formatRecovery(hoursLeft: number): { value: string; unit: string | undefined } {
  if (hoursLeft < 0.5) return { value: 'Sudah pulih', unit: undefined };
  return { value: String(Math.round(hoursLeft)), unit: 'jam' };
}

/** `52:07` under an hour, `1:52:07` from an hour on. */
export function formatRaceTime(totalSec: number): string {
  const s = Math.round(totalSec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(sec).padStart(2, '0')}`;
}

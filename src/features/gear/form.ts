/** Kilometre text of the gear form: what the person types, what is stored (metres). */

export type KmParse = { ok: true; metres: number | null } | { ok: false };

/** "12,5" and "12.5" are 12 500 m, an empty field is null (nothing entered), anything else (letters, minus, "1,2,3") is invalid. */
export function parseKm(text: string): KmParse {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: true, metres: null };
  if (!/^(\d+([.,]\d*)?|[.,]\d+)$/.test(trimmed)) return { ok: false };
  const km = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(km)) return { ok: false };
  return { ok: true, metres: kmToMetres(km) };
}

export function kmToMetres(km: number): number {
  return Math.round(km * 1000);
}

/** Metres as the text of a km field, at most 2 decimals and no digit grouping, with the separator of the language ("12,5" or "12.5"). Zero gives an empty field. */
export function metresToKmText(metres: number | null, decimalComma: boolean): string {
  if (metres === null || metres <= 0) return '';
  const text = String(Math.round(metres / 10) / 100);
  return decimalComma ? text.replace('.', ',') : text;
}

import type { Locale } from "./index";

export const INTL_TAG: Record<Locale, string> = { id: "id-ID", en: "en-US" };

/** A decimal with up to `digits` fraction digits in the locale's separators: `5,5` / `5.5`, `5` for a whole number. */
export function fmtDecimal(value: number, locale: Locale, digits = 1): string {
  return new Intl.NumberFormat(INTL_TAG[locale], { maximumFractionDigits: digits }).format(value);
}

/** A full hour on the clock, 0-23: `11.00` / `11:00 AM`. Local to the monitored person, so no time zone is applied. */
export function fmtHour(hour: number, locale: Locale): string {
  if (locale === "id") return `${String(hour).padStart(2, "0")}.00`;
  return `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`;
}

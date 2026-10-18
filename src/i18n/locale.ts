/** Languages the app ships. Add a code here AND a locales/<code>/ folder (docs/i18n.md). */
export const LOCALES = ['id', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

/** Source language: every key exists in it first; also the last-resort fallback. */
export const DEFAULT_LOCALE: Locale = 'id';

/** The Settings choice: follow the phone, or pin one language. */
export const LOCALE_PREFS = ['auto', ...LOCALES] as const;
export type LocalePref = (typeof LOCALE_PREFS)[number];

/** Language names in their own language. Never translated, so a lost user can find theirs. */
export const LOCALE_NAMES: Record<Locale, string> = {
  id: 'Indonesia',
  en: 'English',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

export function isLocalePref(value: unknown): value is LocalePref {
  return value === 'auto' || isLocale(value);
}

/** Maps a BCP-47 tag ("en-US", "id-ID", legacy Android "in") to a shipped locale, or null. */
export function matchLocale(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const language = tag.trim().toLowerCase().replace(/_/g, '-').split('-')[0];
  if (language === 'in') return 'id';
  return isLocale(language) ? language : null;
}

/** pinned choice → device language → `id`. */
export function resolveLocale({
  pref,
  device,
}: {
  pref?: string | null;
  device?: string | readonly string[] | null;
}): Locale {
  if (isLocale(pref)) return pref;
  const tags = typeof device === 'string' ? [device] : (device ?? []);
  for (const tag of tags) {
    const locale = matchLocale(tag);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}

/** Device languages, most preferred first. Hermes exposes the OS locale through Intl. */
export function deviceLanguages(): string[] {
  try {
    return [new Intl.DateTimeFormat().resolvedOptions().locale];
  } catch {
    return [];
  }
}

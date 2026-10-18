import emailEn from "./locales/en/email.json";
import errorsEn from "./locales/en/errors.json";
import pushEn from "./locales/en/push.json";
import emailId from "./locales/id/email.json";
import errorsId from "./locales/id/errors.json";
import pushId from "./locales/id/push.json";
import { flatten, type Namespaces } from "./keys";

/**
 * Text the Worker writes for someone else (push, email, API answers): in the recipient's language. A Worker serves
 * every language at once, so there is no "current language": callers hold a `Locale` and pass it down.
 */
export type Locale = "id" | "en";
export const LOCALES: readonly Locale[] = ["id", "en"];
export const DEFAULT_LOCALE: Locale = "id";

/** Maps anything a profile or header may hold (`en`, `en-US`, `EN`, `fr`, undefined) to a shipped locale; unknown -> `id`. */
export function matchLocale(value: unknown): Locale {
  if (typeof value !== "string") return DEFAULT_LOCALE;
  const language = value.trim().toLowerCase().split(/[-_]/)[0];
  return LOCALES.find((l) => l === language) ?? DEFAULT_LOCALE;
}

/** The best shipped language of an `Accept-Language` header (quality order); none -> `id`. For answers to a browser with no session. */
export function matchAcceptLanguage(header: string | null | undefined): Locale {
  const ranked = (header ?? "")
    .split(",")
    .map((part, index) => {
      const [tag = "", ...params] = part.trim().split(";");
      const q = Number(params.map((p) => p.trim()).find((p) => p.startsWith("q="))?.slice(2) ?? 1);
      return { tag: tag.trim().toLowerCase().split("-")[0] ?? "", q: Number.isFinite(q) ? q : 0, index };
    })
    .filter((entry) => entry.q > 0)
    .sort((a, b) => b.q - a.q || a.index - b.index);
  return matchLocale(ranked.find((entry) => LOCALES.some((l) => l === entry.tag))?.tag);
}

export const resources = {
  id: { push: pushId, email: emailId, errors: errorsId },
  en: { push: pushEn, email: emailEn, errors: errorsEn },
} satisfies Record<Locale, Namespaces>;

type Resources = typeof resources.id;
type PluralSuffix = "zero" | "one" | "two" | "few" | "many" | "other";
type Leaves<T, P extends string = ""> = { [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Leaves<T[K], `${P}${K}.`> }[keyof T & string];
type Base<K> = K extends `${infer B}_${PluralSuffix}` ? B : K;
type KeysOf<R> = { [N in keyof R & string]: `${N}:${Base<Leaves<R[N]>>}` }[keyof R & string];

/** Every `ns:path` of the Indonesian source, plural suffixes removed. */
export type MessageKey = KeysOf<Resources>;

// English may differ from Indonesian only in plural suffixes: every key the source has must exist (scripts/i18n-keys.ts checks the suffixes).
const _enCoversId: Exclude<KeysOf<Resources>, KeysOf<typeof resources.en>> extends never ? true : never = true;
void _enCoversId;

export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

const flat: Record<Locale, Map<string, string>> = { id: flatten(resources.id), en: flatten(resources.en) };
const pluralRules: Record<Locale, Intl.PluralRules> = { id: new Intl.PluralRules("id"), en: new Intl.PluralRules("en") };

/**
 * A translate function for one recipient: `serverT(locale)("push:family.poke.title", { name })`.
 * `{{param}}` is replaced by the param (an unknown one stays visible); a numeric `count` picks the `_one`/`_other`
 * form by the locale's plural rules. A key missing in `locale` falls back to Indonesian, then to the key itself.
 */
export function serverT(locale: Locale): Translate {
  return (key, params) => {
    const lookup = (l: Locale): string | undefined => {
      const table = flat[l];
      if (typeof params?.count === "number") {
        const plural = table.get(`${key}_${pluralRules[l].select(params.count)}`) ?? table.get(`${key}_other`);
        if (plural !== undefined) return plural;
      }
      return table.get(key);
    };
    const text = lookup(locale) ?? lookup(DEFAULT_LOCALE) ?? key;
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => (params && name in params ? String(params[name]) : whole));
  };
}

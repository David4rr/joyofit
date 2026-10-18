import { useSyncExternalStore } from 'react';

import { getLocale, subscribeLocale } from './core';
import type { Locale } from './locale';

export { applyLocale, getLocale, getT, i18n, t, type TFunction } from './core';
export * from './format';
export {
  DEFAULT_LOCALE,
  LOCALE_NAMES,
  LOCALE_PREFS,
  LOCALES,
  isLocale,
  isLocalePref,
  matchLocale,
  resolveLocale,
  type Locale,
  type LocalePref,
} from './locale';
export { useTranslation, Trans } from 'react-i18next';

/**
 * The rendering language as React state. `useTranslation` already re-renders on a switch;
 * use this when a component only calls the format helpers, or memoises text (put it in the deps).
 */
export function useLocale(): Locale {
  return useSyncExternalStore(subscribeLocale, getLocale, getLocale);
}

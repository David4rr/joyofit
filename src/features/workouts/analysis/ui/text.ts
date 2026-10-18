import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import type { TFunction } from '@/i18n';
import type workouts from '@/i18n/locales/id/workouts.json';

/**
 * Every string the analysis components show lives under `analysis.*` in the `workouts` namespace
 * (src/i18n/locales/<lng>/workouts.json). The cards take a translator `t` from the host so they stay free of the i18n
 * hooks; `useAnalysisT` is that translator for the current language. Placeholders are `{{name}}`; a key that has
 * `_one`/`_other` variants takes a `count`.
 */

type Paths<T, P extends string = ''> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : Paths<T[K], `${P}${K}.`>;
}[keyof T & string];

type StripPlural<S extends string> = S extends `${infer B}_other` ? B : S;

export type AnalysisTextKey = StripPlural<Paths<(typeof workouts)['analysis']>>;

export type AnalysisT = (key: AnalysisTextKey, vars?: Record<string, string | number>) => string;

/** Wraps an i18next translator for the `analysis.*` keys. */
export function makeAnalysisT(t: TFunction): AnalysisT {
  const raw = t as unknown as (key: string, options?: Record<string, unknown>) => string;
  return (key, vars) => raw(`workouts:analysis.${key}`, vars);
}

/** The analysis translator; a new identity on a language switch so memoised cards redraw. */
export function useAnalysisT(): AnalysisT {
  const { t, i18n } = useTranslation('workouts');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => makeAnalysisT(t as unknown as TFunction), [t, i18n.language]);
}

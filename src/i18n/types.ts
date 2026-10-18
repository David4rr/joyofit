import type { DEFAULT_NAMESPACE, Resources } from './resources';

// Typed keys: `useTranslation('workouts')` + `t('list.title')` fail tsc when the key is not in locales/id/*.json.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: typeof DEFAULT_NAMESPACE;
    resources: Resources;
    returnNull: false;
  }
}

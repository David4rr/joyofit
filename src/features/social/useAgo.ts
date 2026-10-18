import { useNow } from '@/hooks/useNow';
import { fmtAgo, useLocale } from '@/i18n';

/** "5 min ago" for an ISO timestamp from JoyoRogo, kept current once a minute and when the language changes. */
export function useAgo(iso: string): string {
  const locale = useLocale();
  return fmtAgo(Date.parse(iso) / 1000, useNow(60_000) / 1000, locale);
}

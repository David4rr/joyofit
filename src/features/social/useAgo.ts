import { useNow } from '@/hooks/useNow';
import { formatAgo } from '@/format';

/** "5 min ago" for an ISO timestamp from JoyoRogo, kept current once a minute. */
export function useAgo(iso: string): string {
  return formatAgo(Date.parse(iso) / 1000, useNow(60_000) / 1000);
}

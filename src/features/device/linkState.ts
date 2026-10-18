import { t } from '@/i18n';
import type { Colors } from '@/theme';
import type { LinkState } from '@/wear';

/** The link state in words, in the active language. */
export function linkLabel(state: LinkState): string {
  return t(`watch:link.${state}`);
}

/** The link is up: the watch answers and can be synced. */
export function isLinkUp(state: LinkState): boolean {
  return state === 'connected' || state === 'syncing';
}

/** Anything but disconnected: the link is up or being set up. Drives the status-dot pulse. */
export function isLinkLive(state: LinkState): boolean {
  return state !== 'disconnected';
}

/** Dot color on the light surfaces: link green while up, warning while setting up, muted when down. */
export function linkDotColor(state: LinkState, colors: Colors): string {
  if (isLinkUp(state)) return colors.link;
  return state === 'disconnected' ? colors.mutedForeground : colors.warning;
}

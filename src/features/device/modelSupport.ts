import { t } from '@/i18n';
import type { BondedDevice, ModelSupport } from '@/wear';

/** Lower first: tested watches, then the ones worth trying, then the ones JoyoFit cannot talk to. */
const RANK: Record<ModelSupport, number> = { tested: 0, experimental: 1, unknown: 2, unsupported: 3 };

export function supportRank(support: ModelSupport): number {
  return RANK[support];
}

/** JoyoFit can try to connect: everything but `unsupported`. */
export function canConnect(device: Pick<BondedDevice, 'support'>): boolean {
  return device.support !== 'unsupported';
}

/** Short word for a pill or a value row. */
export function supportLabel(support: ModelSupport): string {
  return t(`watch:support.${support}`);
}

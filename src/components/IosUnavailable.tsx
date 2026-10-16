import { Platform } from 'react-native';

import type { IconName } from '@/components/IconChip';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import type { Tint } from '@/theme';

/** True on iOS, where a feature that needs another app's data, a phone permission iOS never grants or an unported protocol layer is switched off. */
export const isIos = Platform.OS === 'ios';

/** What the unported features say: no iOS counterpart is missing, the work is just not done. */
export const IOS_NOT_YET = 'This is not available on iOS yet.';

interface IosUnavailableProps {
  title: string;
  icon?: IconName;
  tint?: Tint;
  /** Why, in one or two sentences. Defaults to the "not yet" text. */
  reason?: string;
}

/** A settings card that replaces a feature's controls on iOS, with the reason instead of a button that errors. */
export function IosUnavailable({ title, icon, tint, reason = IOS_NOT_YET }: IosUnavailableProps) {
  return (
    <Section title={title} icon={icon} tint={tint}>
      <Notice icon="information-circle">{reason}</Notice>
    </Section>
  );
}

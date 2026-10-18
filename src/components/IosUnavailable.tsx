import { Platform } from 'react-native';

import { useTranslation } from 'react-i18next';

import type { IconName } from '@/components/IconChip';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import type { Tint } from '@/theme';

/** True on iOS, where a feature that needs another app's data, a phone permission iOS never grants or an unported protocol layer is switched off. */
export const isIos = Platform.OS === 'ios';

// The "not yet" text lives in `common:iosNotYet`: no iOS counterpart is missing, the work is just not done.

interface IosUnavailableProps {
  title: string;
  icon?: IconName;
  tint?: Tint;
  /** Why, in one or two sentences. Defaults to the "not yet" text. */
  reason?: string;
}

/** A settings card that replaces a feature's controls on iOS, with the reason instead of a button that errors. */
export function IosUnavailable({ title, icon, tint, reason }: IosUnavailableProps) {
  const { t } = useTranslation('common');
  return (
    <Section title={title} icon={icon} tint={tint}>
      <Notice icon="information-circle">{reason ?? t('iosNotYet')}</Notice>
    </Section>
  );
}

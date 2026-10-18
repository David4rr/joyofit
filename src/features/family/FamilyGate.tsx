import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Notice } from '@/components/States';
import { SignInGate } from '@/features/social/SignInGate';
import { useCloud } from '@/state/CloudProvider';

/** What a family screen shows: its content for a signed-in JoyoRogo account, a sign-in prompt otherwise. */
export function FamilyGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation('family');
  const cloud = useCloud();
  if (!cloud.configured) return <Notice tone="danger">{t('errors.notConfigured')}</Notice>;
  const copy = { title: t('gate.signInTitle'), description: t('gate.signInDescription') };
  return <SignInGate copy={copy}>{children}</SignInGate>;
}

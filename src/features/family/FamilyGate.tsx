import type { ReactNode } from 'react';

import { Notice } from '@/components/States';
import { SignInGate } from '@/features/social/SignInGate';
import { useCloud } from '@/state/CloudProvider';

const SIGN_IN_COPY = {
  title: 'Masuk dengan JoyoRogo',
  description: 'Kabar keluarga memakai akun JoyoRogo kamu, akun yang sama dengan buku makan dan tab Social.',
};

/** What a family screen shows: its content for a signed-in JoyoRogo account, a sign-in prompt otherwise. */
export function FamilyGate({ children }: { children: ReactNode }) {
  const cloud = useCloud();
  if (!cloud.configured) return <Notice tone="danger">Server JoyoFit belum diatur di versi aplikasi ini.</Notice>;
  return <SignInGate copy={SIGN_IN_COPY}>{children}</SignInGate>;
}

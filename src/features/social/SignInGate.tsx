import type { ReactNode } from 'react';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';

/** What a social screen shows: its content for a signed-in JoyoRogo account, the sign-in prompt otherwise. */
export function SignInGate({ children }: { children: ReactNode }) {
  const cloud = useCloud();
  if (cloud.sessionPending) return <Skeleton width="100%" height={120} radius="card" />;
  if (!cloud.signedIn) {
    return (
      <Card>
        <AppText variant="heading">Sign in with JoyoRogo</AppText>
        <AppText variant="caption" muted>
          The feed, your groups and sharing a workout use your JoyoRogo account, the same one as the food diary.
        </AppText>
        {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
        <SignInButtons />
      </Card>
    );
  }
  return <>{children}</>;
}

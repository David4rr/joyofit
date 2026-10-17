import type { ReactNode } from 'react';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';

const SOCIAL_COPY = {
  title: 'Sign in with JoyoRogo',
  description: 'The feed, your groups and sharing a workout use your JoyoRogo account, the same one as the food diary.',
};

/** What a screen shows: its content for a signed-in JoyoRogo account, the sign-in prompt otherwise. `copy` words the prompt for another feature than Social. */
export function SignInGate({ children, copy = SOCIAL_COPY }: { children: ReactNode; copy?: { title: string; description: string } }) {
  const cloud = useCloud();
  if (cloud.sessionPending) return <Skeleton width="100%" height={120} radius="card" />;
  if (!cloud.signedIn) {
    return (
      <Card>
        <AppText variant="heading">{copy.title}</AppText>
        <AppText variant="caption" muted>
          {copy.description}
        </AppText>
        {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
        <SignInButtons />
      </Card>
    );
  }
  return <>{children}</>;
}

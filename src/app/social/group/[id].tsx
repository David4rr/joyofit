import { Stack, useLocalSearchParams } from 'expo-router';
import { Fragment, useCallback, useState } from 'react';

import { authClient } from '@/cloud/auth';
import { rogo, type RogoGroupMember } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Divider, Screen, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { MemberRow } from '@/features/social/MemberRow';
import { SignInGate } from '@/features/social/SignInGate';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { errorMessage } from '@/format';
import { useCloud } from '@/state/CloudProvider';

type ShareField = 'shareFitness' | 'shareFood';

/** A group: its members with the scores they share today, and your own sharing switches for it. */
export default function GroupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cloud = useCloud();
  const me = authClient.useSession().data?.user.id;
  const load = useCallback(() => rogo.group.detail(id), [id]);
  const { data: detail, error, refreshing, refresh, setData } = useRogoQuery(load, cloud.signedIn);
  const [shareError, setShareError] = useState<string | null>(null);
  const mine = detail?.members.find((m) => m.userId === me);

  /** Flips the switch at once and puts it back when JoyoRogo refuses. */
  const setShare = async (field: ShareField, on: boolean) => {
    if (!detail) return;
    const patch = (member: RogoGroupMember): RogoGroupMember => (member.userId === me ? { ...member, [field]: on } : member);
    setShareError(null);
    setData({ ...detail, members: detail.members.map(patch) });
    try {
      await (field === 'shareFitness' ? rogo.group.setShareFitness(id, on) : rogo.group.setShareFood(id, on));
    } catch (e) {
      setData(detail);
      setShareError(errorMessage(e));
    }
  };

  return (
    <Screen refresh={{ refreshing, onRefresh: () => void refresh(), enabled: cloud.signedIn }}>
      <Stack.Screen options={{ title: detail?.group.name ?? 'Group' }} />
      <SignInGate>
        {detail ? (
          <>
            <Section title="Members" icon="people" tint="link">
              {detail.members.map((member, i) => (
                <Fragment key={member.userId}>
                  {i > 0 ? <Divider /> : null}
                  <MemberRow member={member} isMe={member.userId === me} />
                </Fragment>
              ))}
              <AppText variant="caption" muted>
                Invite code {detail.group.inviteCode}
              </AppText>
            </Section>
            {mine ? (
              <Section title="Sharing with this group" icon="share-social" tint="link">
                <SwitchRow
                  label="Share JoyoFit scores"
                  hint="Today's recovery, strain, sleep and readiness, visible to the members."
                  value={mine.shareFitness}
                  onValueChange={(on) => void setShare('shareFitness', on)}
                />
                <SwitchRow
                  label="Share food names"
                  hint="Members see what you ate, not only the calories."
                  value={mine.shareFood}
                  onValueChange={(on) => void setShare('shareFood', on)}
                />
                {shareError ? <Notice tone="danger">{shareError}</Notice> : null}
              </Section>
            ) : null}
          </>
        ) : error !== null ? (
          <Notice tone="danger" action={{ label: 'Try again', onPress: () => void refresh() }}>
            {error}
          </Notice>
        ) : (
          <>
            <Skeleton width="100%" height={200} radius="card" />
            <Skeleton width="100%" height={140} radius="card" />
          </>
        )}
      </SignInGate>
    </Screen>
  );
}

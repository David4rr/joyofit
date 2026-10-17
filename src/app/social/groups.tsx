import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { View } from 'react-native';

import { rogo } from '@/cloud/rogo';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { Screen, Section } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { SignInGate } from '@/features/social/SignInGate';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { errorMessage } from '@/format';
import { useCloud } from '@/state/CloudProvider';
import { useTheme } from '@/theme';

/** JoyoRogo's shortest invite code. */
const MIN_CODE = 4;

/** Your groups, and joining another with its invite code. Creating a group stays in JoyoRogo. */
export default function GroupsScreen() {
  const router = useRouter();
  const theme = useTheme();
  const cloud = useCloud();
  const { data: groups, error, refreshing, refresh } = useRogoQuery(rogo.group.list, cloud.signedIn);
  const [code, setCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const join = useCallback(async () => {
    setJoining(true);
    setJoinError(null);
    try {
      const { groupId } = await rogo.group.join(code.trim());
      setCode('');
      router.push({ pathname: '/social/group/[id]', params: { id: groupId } });
    } catch (e) {
      setJoinError(errorMessage(e));
    } finally {
      setJoining(false);
    }
  }, [code, router]);

  return (
    <Screen refresh={{ refreshing, onRefresh: () => void refresh(), enabled: cloud.signedIn }}>
      <SignInGate>
        {groups ? (
          groups.length > 0 ? (
            <View>
              {groups.map((group, i) => (
                <NavRow
                  key={group.id}
                  icon="people"
                  tint="link"
                  title={group.name}
                  subtitle={`${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`}
                  style={groupedRowStyle(theme, i, groups.length)}
                  onPress={() => router.push({ pathname: '/social/group/[id]', params: { id: group.id } })}
                />
              ))}
            </View>
          ) : (
            <EmptyState icon="people" title="No groups yet" description="Join one with an invite code from a friend, or create one in JoyoRogo." />
          )
        ) : error !== null ? (
          <Notice tone="danger" action={{ label: 'Try again', onPress: () => void refresh() }}>
            {error}
          </Notice>
        ) : (
          <Skeleton width="100%" height={128} radius="card" />
        )}
        <Section title="Join a group" icon="enter" tint="link">
          <Field
            label="Invite code"
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => code.trim().length >= MIN_CODE && !joining && void join()}
          />
          {joinError ? <Notice tone="danger">{joinError}</Notice> : null}
          <Button label="Join" variant="primary" icon="enter" disabled={code.trim().length < MIN_CODE} loading={joining} onPress={() => void join()} />
        </Section>
      </SignInGate>
    </Screen>
  );
}

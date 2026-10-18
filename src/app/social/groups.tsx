import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  const { t } = useTranslation(['social', 'common']);
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
                  subtitle={t('groups.memberCount', { count: group.memberCount })}
                  style={groupedRowStyle(theme, i, groups.length)}
                  onPress={() => router.push({ pathname: '/social/group/[id]', params: { id: group.id } })}
                />
              ))}
            </View>
          ) : (
            <EmptyState icon="people" title={t('groups.emptyTitle')} description={t('groups.emptyDescription')} />
          )
        ) : error !== null ? (
          <Notice tone="danger" action={{ label: t('common:actions.retry'), onPress: () => void refresh() }}>
            {error}
          </Notice>
        ) : (
          <Skeleton width="100%" height={128} radius="card" />
        )}
        <Section title={t('groups.joinTitle')} icon="enter" tint="link">
          <Field
            label={t('groups.inviteCode')}
            value={code}
            onChangeText={setCode}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => code.trim().length >= MIN_CODE && !joining && void join()}
          />
          {joinError ? <Notice tone="danger">{joinError}</Notice> : null}
          <Button label={t('groups.join')} variant="primary" icon="enter" disabled={code.trim().length < MIN_CODE} loading={joining} onPress={() => void join()} />
        </Section>
      </SignInGate>
    </Screen>
  );
}

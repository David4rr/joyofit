import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { rogo, type RogoBlockedUser } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card, Screen } from '@/components/Screen';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { SignInGate } from '@/features/social/SignInGate';
import { setBlocked, unhide } from '@/features/social/moderation';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { errorMessage } from '@/format';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';

/** Settings, Account, Blocked users: the people the person blocked in Social, each with "Unblock". */
export default function BlockedUsersScreen() {
  const { t } = useTranslation(['social', 'common']);
  const cloud = useCloud();
  const load = useCallback(async () => {
    const list = await rogo.social.blockList();
    setBlocked(list.map((u) => u.id));
    return list;
  }, []);
  const { data, error, refreshing, refresh, setData } = useRogoQuery(load, cloud.signedIn);
  const [working, setWorking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const unblock = async (user: RogoBlockedUser) => {
    setWorking(user.id);
    setProblem(null);
    try {
      await rogo.social.unblock(user.id);
      unhide('blockedUsers', user.id);
      if (data) setData(data.filter((u) => u.id !== user.id));
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setWorking(null);
    }
  };

  return (
    <Screen refresh={{ refreshing, onRefresh: () => void refresh(), enabled: cloud.signedIn }}>
      <SignInGate>
        <AppText variant="caption" muted>
          {t('moderation.blocked.description')}
        </AppText>
        {problem ? <Notice tone="danger">{problem}</Notice> : null}
        {data ? (
          data.length === 0 ? (
            <EmptyState icon="shield-checkmark" title={t('moderation.blocked.title')} description={t('moderation.blocked.empty')} />
          ) : (
            <Card>
              {data.map((user) => (
                <View key={user.id} style={styles.row}>
                  <Avatar name={user.name} image={user.image} size="sm" />
                  <View style={styles.grow}>
                    <AppText variant="bodyStrong" numberOfLines={1}>
                      {user.name}
                    </AppText>
                    {user.handle ? (
                      <AppText variant="caption" muted numberOfLines={1}>
                        @{user.handle}
                      </AppText>
                    ) : null}
                  </View>
                  <Button
                    label={t('moderation.blocked.unblock')}
                    loading={working === user.id}
                    disabled={working !== null}
                    onPress={() => void unblock(user)}
                  />
                </View>
              ))}
            </Card>
          )
        ) : error !== null ? (
          <Notice tone="danger" action={{ label: t('common:actions.retry'), onPress: () => void refresh() }}>
            {error}
          </Notice>
        ) : (
          <Skeleton width="100%" height={96} radius="card" />
        )}
      </SignInGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  grow: { flex: 1 },
});

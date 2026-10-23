import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { rogo, type RogoPublicProfile } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { ModerationMenu } from '@/features/social/ModerationMenu';
import { PostList } from '@/features/social/PostList';
import { ProfileHeader } from '@/features/social/ProfileHeader';
import { SignInGate } from '@/features/social/SignInGate';
import { useHidden } from '@/features/social/moderation';
import { userHidden } from '@/features/social/moderationCore';
import { usePagedPosts } from '@/features/social/usePagedPosts';
import { useCloud } from '@/state/CloudProvider';

const profilePosts = (profile: RogoPublicProfile) => profile.posts;

/** Someone's public JoyoRogo profile and their public posts. */
export default function PublicProfileScreen() {
  const { t } = useTranslation(['social', 'common']);
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const cloud = useCloud();
  const router = useRouter();
  const hidden = useHidden();
  const fetchProfile = useCallback((cursor?: number) => rogo.social.publicProfile(handle, cursor), [handle]);
  const posts = usePagedPosts(handle, fetchProfile, profilePosts, cloud.signedIn);
  const profile = posts.head;

  return (
    <Screen refresh={{ refreshing: posts.refreshing, onRefresh: () => void posts.refresh(), enabled: cloud.signedIn }}>
      <Stack.Screen options={{ title: `@${handle}` }} />
      <SignInGate>
        {profile && userHidden(hidden, profile.userId) ? (
          <Notice icon="eye-off">{t('moderation.profileHidden')}</Notice>
        ) : profile ? (
          <>
            <ProfileHeader
              name={profile.name}
              handle={profile.handle}
              image={profile.image}
              bio={profile.bio}
              trailing={<ModerationMenu target={{ kind: 'profile' }} author={{ id: profile.userId, name: profile.name }} onBlocked={() => router.back()} />}
              counts={profile.stats && { posts: profile.stats.postCount, followers: profile.stats.followerCount, following: profile.stats.followingCount }}
            />
            {profile.publicProfile ? (
              <>
                <AppText variant="heading" accessibilityRole="header">
                  {t('profile.publicPosts')}
                </AppText>
                <PostList posts={posts} linkAuthor={false} empty={{ title: t('profile.publicEmptyTitle'), description: t('profile.publicEmptyDescription') }} />
              </>
            ) : (
              <Notice icon="lock-closed">{t('profile.private')}</Notice>
            )}
          </>
        ) : posts.error !== null ? (
          <Notice tone="danger" action={{ label: t('common:actions.retry'), onPress: () => void posts.refresh() }}>
            {posts.error}
          </Notice>
        ) : (
          <Skeleton width="100%" height={120} radius="card" />
        )}
      </SignInGate>
    </Screen>
  );
}

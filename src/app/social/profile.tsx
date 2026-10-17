import { useCallback } from 'react';

import { authClient } from '@/cloud/auth';
import { rogo } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { PostList } from '@/features/social/PostList';
import { ProfileHeader } from '@/features/social/ProfileHeader';
import { SignInGate } from '@/features/social/SignInGate';
import { usePagedPosts, wholePage } from '@/features/social/usePagedPosts';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { useCloud } from '@/state/CloudProvider';

/** The signed-in person's feed profile and their own posts. Tapping a post opens it; other people's names open theirs. */
export default function MyProfileScreen() {
  const cloud = useCloud();
  const user = authClient.useSession().data?.user;
  const name = user?.name ?? '';
  const profile = useRogoQuery(rogo.social.myProfile, cloud.signedIn);
  const fetchMine = useCallback((cursor?: number) => rogo.social.myPosts(cursor), []);
  const posts = usePagedPosts('mine', fetchMine, wholePage, cloud.signedIn);

  return (
    <Screen
      refresh={{
        refreshing: profile.refreshing || posts.refreshing,
        onRefresh: () => void Promise.all([profile.refresh(), posts.refresh()]),
        enabled: cloud.signedIn,
      }}>
      <SignInGate>
        {profile.data ? (
          <ProfileHeader
            name={name}
            handle={profile.data.handle}
            image={user?.image}
            counts={{ posts: profile.data.postCount, followers: profile.data.followerCount, following: profile.data.followingCount }}
          />
        ) : profile.error !== null ? (
          <Notice tone="danger" action={{ label: 'Try again', onPress: () => void profile.refresh() }}>
            {profile.error}
          </Notice>
        ) : (
          <Skeleton width="100%" height={120} radius="card" />
        )}
        <AppText variant="heading" accessibilityRole="header">
          My posts
        </AppText>
        <PostList posts={posts} linkAuthor={false} empty={{ title: 'No posts yet', description: 'Share a workout from its screen and it shows up here.' }} />
      </SignInGate>
    </Screen>
  );
}

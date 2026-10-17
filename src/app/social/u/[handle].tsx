import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { rogo, type RogoPublicProfile } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { PostList } from '@/features/social/PostList';
import { ProfileHeader } from '@/features/social/ProfileHeader';
import { SignInGate } from '@/features/social/SignInGate';
import { usePagedPosts } from '@/features/social/usePagedPosts';
import { useCloud } from '@/state/CloudProvider';

const profilePosts = (profile: RogoPublicProfile) => profile.posts;

/** Someone's public JoyoRogo profile and their public posts. */
export default function PublicProfileScreen() {
  const { handle } = useLocalSearchParams<{ handle: string }>();
  const cloud = useCloud();
  const fetchProfile = useCallback((cursor?: number) => rogo.social.publicProfile(handle, cursor), [handle]);
  const posts = usePagedPosts(handle, fetchProfile, profilePosts, cloud.signedIn);
  const profile = posts.head;

  return (
    <Screen refresh={{ refreshing: posts.refreshing, onRefresh: () => void posts.refresh(), enabled: cloud.signedIn }}>
      <Stack.Screen options={{ title: `@${handle}` }} />
      <SignInGate>
        {profile ? (
          <>
            <ProfileHeader
              name={profile.name}
              handle={profile.handle}
              image={profile.image}
              bio={profile.bio}
              counts={profile.stats && { posts: profile.stats.postCount, followers: profile.stats.followerCount, following: profile.stats.followingCount }}
            />
            {profile.publicProfile ? (
              <>
                <AppText variant="heading" accessibilityRole="header">
                  Public posts
                </AppText>
                <PostList posts={posts} linkAuthor={false} empty={{ title: 'No public posts', description: 'Nothing shared publicly yet.' }} />
              </>
            ) : (
              <Notice icon="lock-closed">This profile is private.</Notice>
            )}
          </>
        ) : posts.error !== null ? (
          <Notice tone="danger" action={{ label: 'Try again', onPress: () => void posts.refresh() }}>
            {posts.error}
          </Notice>
        ) : (
          <Skeleton width="100%" height={120} radius="card" />
        )}
      </SignInGate>
    </Screen>
  );
}

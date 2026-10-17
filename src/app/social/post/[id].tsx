import { useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';

import { rogo } from '@/cloud/rogo';
import { Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { CommentsSection } from '@/features/social/CommentsSection';
import { PostCard } from '@/features/social/PostCard';
import { SignInGate } from '@/features/social/SignInGate';
import { WorkoutDetailSection } from '@/features/social/WorkoutDetailSection';
import { watchStats } from '@/features/social/postStats';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { useCloud } from '@/state/CloudProvider';

export default function PostScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const cloud = useCloud();
  const load = useCallback(() => rogo.social.post(id), [id]);
  const { data: post, error, refreshing, refresh, setData } = useRogoQuery(load, cloud.signedIn);
  const stats = post ? watchStats(post) : null;

  return (
    <Screen refresh={{ refreshing, onRefresh: () => void refresh(), enabled: cloud.signedIn }}>
      <SignInGate>
        {post ? (
          <>
            <PostCard post={post} onChange={setData} />
            {stats?.hasDetail === 1 ? <WorkoutDetailSection postId={post.id} startedAt={stats.startedAt} /> : null}
            <CommentsSection postId={post.id} onAdded={() => void refresh()} />
          </>
        ) : error !== null ? (
          <Notice tone="danger" action={{ label: 'Try again', onPress: () => void refresh() }}>
            {error}
          </Notice>
        ) : (
          <Skeleton width="100%" height={200} radius="card" />
        )}
      </SignInGate>
    </Screen>
  );
}

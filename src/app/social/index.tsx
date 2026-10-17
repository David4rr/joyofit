import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';

import { rogo } from '@/cloud/rogo';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Screen } from '@/components/Screen';
import { Segmented } from '@/components/Segmented';
import { PostList } from '@/features/social/PostList';
import { SignInGate } from '@/features/social/SignInGate';
import { usePagedPosts, wholePage } from '@/features/social/usePagedPosts';
import { useCloud } from '@/state/CloudProvider';

type FeedTab = 'mengikuti' | 'jelajah';

const TABS = [
  { value: 'mengikuti', label: 'Following' },
  { value: 'jelajah', label: 'Explore' },
] as const;

const EMPTY = {
  mengikuti: {
    title: 'Nothing here yet',
    description: 'Posts from you, the people you follow and your groups show up here. Share a workout from its screen to start.',
  },
  jelajah: { title: 'No public posts yet', description: 'Public posts from JoyoRogo show up here.' },
} as const;

/** The JoyoRogo feed: people you follow and your groups, or everything public. */
export default function SocialScreen() {
  const router = useRouter();
  const cloud = useCloud();
  const [tab, setTab] = useState<FeedTab>('mengikuti');
  const fetchFeed = useCallback((cursor?: number) => rogo.social.feed(tab, cursor), [tab]);
  const posts = usePagedPosts(tab, fetchFeed, wholePage, cloud.signedIn);

  return (
    <Screen
      title="Social"
      caption="Workouts, meals and groups from JoyoRogo"
      refresh={{ refreshing: posts.refreshing, onRefresh: () => void posts.refresh(), enabled: cloud.signedIn }}>
      <SignInGate>
        <ButtonRow>
          <Button label="Groups" icon="people" onPress={() => router.push('/social/groups')} />
          <Button label="My profile" icon="person" onPress={() => router.push('/social/profile')} />
        </ButtonRow>
        <Segmented options={TABS} value={tab} onChange={setTab} />
        <PostList posts={posts} empty={EMPTY[tab]} />
      </SignInGate>
    </Screen>
  );
}

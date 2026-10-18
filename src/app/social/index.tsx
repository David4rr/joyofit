import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

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

/** The JoyoRogo feed: people you follow and your groups, or everything public. */
export default function SocialScreen() {
  const { t } = useTranslation('social');
  const router = useRouter();
  const cloud = useCloud();
  const [tab, setTab] = useState<FeedTab>('mengikuti');
  const fetchFeed = useCallback((cursor?: number) => rogo.social.feed(tab, cursor), [tab]);
  const posts = usePagedPosts(tab, fetchFeed, wholePage, cloud.signedIn);
  const tabs = [
    { value: 'mengikuti', label: t('feed.tabFollowing') },
    { value: 'jelajah', label: t('feed.tabExplore') },
  ] as const;
  const empty =
    tab === 'mengikuti'
      ? { title: t('feed.emptyFollowingTitle'), description: t('feed.emptyFollowingDescription') }
      : { title: t('feed.emptyExploreTitle'), description: t('feed.emptyExploreDescription') };

  return (
    <Screen
      title={t('feed.title')}
      caption={t('feed.caption')}
      refresh={{ refreshing: posts.refreshing, onRefresh: () => void posts.refresh(), enabled: cloud.signedIn }}>
      <SignInGate>
        <ButtonRow>
          <Button label={t('feed.groups')} icon="people" onPress={() => router.push('/social/groups')} />
          <Button label={t('feed.myProfile')} icon="person" onPress={() => router.push('/social/profile')} />
        </ButtonRow>
        <Segmented options={tabs} value={tab} onChange={setTab} />
        <PostList posts={posts} empty={empty} />
      </SignInGate>
    </Screen>
  );
}

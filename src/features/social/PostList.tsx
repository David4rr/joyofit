import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { Button } from '@/components/Button';
import { FadeIn } from '@/components/motion';
import { EmptyState, Notice, Skeleton } from '@/components/States';
import { PostCard } from '@/features/social/PostCard';
import type { PagedPosts } from '@/features/social/usePagedPosts';
import { spacing } from '@/theme';

interface PostListProps {
  posts: PagedPosts<unknown>;
  empty: { title: string; description: string };
  /** Passed to each card; off on a profile screen. */
  linkAuthor?: boolean;
}

/** The posts of a paged list with its loading, error and empty states and a "Load more" button. */
export function PostList({ posts, empty, linkAuthor }: PostListProps) {
  const { t } = useTranslation(['social', 'common']);
  const router = useRouter();
  const retry = { label: t('common:actions.retry'), onPress: () => void posts.refresh() };

  if (posts.items === null) {
    return posts.error !== null ? (
      <Notice tone="danger" action={retry}>
        {posts.error}
      </Notice>
    ) : (
      <View style={styles.list}>
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} width="100%" height={168} radius="card" />
        ))}
      </View>
    );
  }
  if (posts.items.length === 0) return <EmptyState icon="people" title={empty.title} description={empty.description} />;
  return (
    <View style={styles.list}>
      {posts.error !== null ? (
        <Notice tone="danger" action={retry}>
          {posts.error}
        </Notice>
      ) : null}
      {posts.items.map((post, i) => (
        // Only the first screenful staggers; posts added by "Load more" appear below the fold and just fade in.
        <FadeIn key={post.id} delay={i < 6 ? i * 45 : 0}>
          <PostCard
            post={post}
            linkAuthor={linkAuthor}
            onChange={posts.replace}
            onOpen={() => router.push({ pathname: '/social/post/[id]', params: { id: post.id } })}
          />
        </FadeIn>
      ))}
      {posts.hasMore ? <Button label={t('list.loadMore')} loading={posts.loadingMore} onPress={() => void posts.loadMore()} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.md },
});

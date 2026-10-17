import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { rogo, type RogoComment } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Input } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { Divider, Section } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { useAgo } from '@/features/social/useAgo';
import { useRogoQuery } from '@/features/social/useRogoQuery';
import { errorMessage } from '@/format';
import { spacing } from '@/theme';

/** JoyoRogo's limit for one comment. */
const COMMENT_MAX = 280;

function CommentRow({ comment }: { comment: RogoComment }) {
  const router = useRouter();
  const handle = comment.author.handle;
  const ago = useAgo(comment.createdAt);
  return (
    <View style={styles.comment}>
      <PressableScale
        accessibilityRole="button"
        accessibilityLabel={`Open the profile of ${comment.author.name}`}
        disabled={handle === null}
        onPress={() => handle && router.push({ pathname: '/social/u/[handle]', params: { handle } })}>
        <AppText variant="bodyStrong">
          {comment.author.name}
          <AppText variant="caption" muted>
            {'  '}
            {ago}
          </AppText>
        </AppText>
      </PressableScale>
      <AppText variant="body">{comment.body}</AppText>
    </View>
  );
}

/** The comments of a post, oldest first, and a box to add one. `onAdded` lets the screen refresh the post's comment count. */
export function CommentsSection({ postId, onAdded }: { postId: string; onAdded: () => void }) {
  const load = useCallback(() => rogo.social.comments(postId), [postId]);
  const { data, error, setData } = useRogoQuery(load, true);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const send = async () => {
    setSending(true);
    setProblem(null);
    try {
      await rogo.social.addComment(postId, draft.trim());
      setDraft('');
      setData(await rogo.social.comments(postId));
      onAdded();
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setSending(false);
    }
  };

  const loadMore = async () => {
    if (!data || data.nextCursor === null) return;
    setLoadingMore(true);
    setProblem(null);
    try {
      const page = await rogo.social.comments(postId, data.nextCursor);
      setData({ items: [...data.items, ...page.items], nextCursor: page.nextCursor });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Section title="Comments" icon="chatbubbles" tint="link">
      {data ? (
        data.items.length > 0 ? (
          data.items.map((comment, i) => (
            <View key={comment.id} style={styles.item}>
              {i > 0 ? <Divider /> : null}
              <CommentRow comment={comment} />
            </View>
          ))
        ) : (
          <AppText variant="caption" muted>
            No comments yet.
          </AppText>
        )
      ) : error !== null ? (
        <Notice tone="danger">{error}</Notice>
      ) : (
        <Skeleton width="100%" height={56} />
      )}
      {data && data.nextCursor !== null ? (
        <Button label="Load more comments" loading={loadingMore} onPress={() => void loadMore()} />
      ) : null}
      <Input
        accessibilityLabel="Add a comment"
        placeholder="Add a comment"
        value={draft}
        onChangeText={setDraft}
        maxLength={COMMENT_MAX}
        editable={!sending}
        returnKeyType="send"
        onSubmitEditing={() => draft.trim() && !sending && void send()}
      />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      <Button label="Post comment" variant="primary" icon="send" disabled={draft.trim().length === 0} loading={sending} onPress={() => void send()} />
    </Section>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.sm },
  comment: { gap: 2 },
});

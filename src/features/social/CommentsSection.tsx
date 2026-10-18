import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, View } from "react-native";

import { rogo, type RogoComment } from "@/cloud/rogo";
import { AppText } from "@/components/AppText";
import { Avatar } from "@/components/Avatar";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { FadeIn, useFlash } from "@/components/motion";
import { PressableScale } from "@/components/PressableScale";
import { Divider, Section } from "@/components/Screen";
import { Notice, Skeleton } from "@/components/States";
import { useAgo } from "@/features/social/useAgo";
import { useRogoQuery } from "@/features/social/useRogoQuery";
import { errorMessage } from "@/format";
import { spacing } from "@/theme";

/** JoyoRogo's limit for one comment. */
const COMMENT_MAX = 280;

function CommentRow({ comment }: { comment: RogoComment }) {
  const { t } = useTranslation('social');
  const router = useRouter();
  const handle = comment.author.handle;
  const ago = useAgo(comment.createdAt);
  return (
    <View style={styles.comment}>
      <Avatar
        name={comment.author.name}
        image={comment.author.image}
        size="sm"
      />
      <View style={styles.commentBody}>
        <PressableScale
          accessibilityRole="button"
          accessibilityLabel={t('post.openProfile', { name: comment.author.name })}
          disabled={handle === null}
          onPress={() =>
            handle &&
            router.push({ pathname: "/social/u/[handle]", params: { handle } })
          }
        >
          <AppText variant="bodyStrong">
            {comment.author.name}
            <AppText variant="caption" muted>
              {"  "}
              {ago}
            </AppText>
          </AppText>
        </PressableScale>
        <AppText variant="body">{comment.body}</AppText>
      </View>
    </View>
  );
}

/** The comments of a post, oldest first, and a box to add one. `onAdded` lets the screen refresh the post's comment count. */
export function CommentsSection({
  postId,
  onAdded,
}: {
  postId: string;
  onAdded: () => void;
}) {
  const { t } = useTranslation('social');
  const load = useCallback(() => rogo.social.comments(postId), [postId]);
  const { data, error, setData } = useRogoQuery(load, true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, flashSent] = useFlash(1600);

  const send = async () => {
    setSending(true);
    setProblem(null);
    try {
      await rogo.social.addComment(postId, draft.trim());
      setDraft("");
      setData(await rogo.social.comments(postId));
      onAdded();
      flashSent();
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
      setData({
        items: [...data.items, ...page.items],
        nextCursor: page.nextCursor,
      });
    } catch (e) {
      setProblem(errorMessage(e));
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Section title={t('comments.title')} icon="chatbubbles" tint="link">
      {data ? (
        data.items.length > 0 ? (
          data.items.map((comment, i) => (
            <FadeIn
              key={comment.id}
              delay={i < 6 ? i * 40 : 0}
              distance={6}
              style={styles.item}
            >
              {i > 0 ? <Divider /> : null}
              <CommentRow comment={comment} />
            </FadeIn>
          ))
        ) : (
          <AppText variant="caption" muted>
            {t('comments.empty')}
          </AppText>
        )
      ) : error !== null ? (
        <Notice tone="danger">{error}</Notice>
      ) : (
        <Skeleton width="100%" height={56} />
      )}
      {data && data.nextCursor !== null ? (
        <Button
          label={t('comments.loadMore')}
          loading={loadingMore}
          onPress={() => void loadMore()}
        />
      ) : null}
      <Input
        accessibilityLabel={t('comments.add')}
        placeholder={t('comments.add')}
        value={draft}
        onChangeText={setDraft}
        maxLength={COMMENT_MAX}
        editable={!sending}
        returnKeyType="send"
        onSubmitEditing={() => draft.trim() && !sending && void send()}
      />
      {problem ? <Notice tone="danger">{problem}</Notice> : null}
      <Button
        label={t('comments.send')}
        variant="primary"
        icon="send"
        disabled={draft.trim().length === 0}
        loading={sending}
        done={sent}
        onPress={() => void send()}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  item: { gap: spacing.sm },
  comment: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  commentBody: { flex: 1, gap: 2 },
});

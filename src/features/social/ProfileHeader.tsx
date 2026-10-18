import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Avatar } from '@/components/Avatar';
import { Metric } from '@/components/Metric';
import { Card } from '@/components/Screen';
import { formatCount } from '@/format';
import { spacing } from '@/theme';

interface ProfileHeaderProps {
  name: string;
  handle: string | null;
  image?: string | null;
  bio?: string | null;
  /** Null for a private profile: it shows no numbers. */
  counts: { posts: number; followers: number; following: number } | null;
}

/** Name, @handle, bio and the post, follower and following counts of a profile. */
export function ProfileHeader({ name, handle, image, bio, counts }: ProfileHeaderProps) {
  const { t } = useTranslation('social');
  return (
    <Card>
      <View style={styles.head}>
        <Avatar name={name} image={image} size="lg" />
        <View style={styles.title}>
          <AppText variant="heading" numberOfLines={2}>
            {name}
          </AppText>
          {handle ? (
            <AppText variant="caption" muted>
              @{handle}
            </AppText>
          ) : null}
        </View>
      </View>
      {bio ? <AppText variant="body">{bio}</AppText> : null}
      {counts ? (
        <View style={styles.counts}>
          <Count label={t('profile.posts')} value={counts.posts} />
          <Count label={t('profile.followers')} value={counts.followers} />
          <Count label={t('profile.following')} value={counts.following} />
        </View>
      ) : null}
    </Card>
  );
}

function Count({ label, value }: { label: string; value: number }) {
  return (
    <View accessible accessibilityLabel={`${label}: ${value}`} style={styles.count}>
      <Metric value={formatCount(value)} size="md" />
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  title: { flex: 1, gap: 2 },
  counts: { flexDirection: 'row', gap: spacing.lg },
  count: { gap: 0 },
});

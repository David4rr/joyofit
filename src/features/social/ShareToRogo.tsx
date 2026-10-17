import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { rogo, type RogoVisibility } from '@/cloud/rogo';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import type { WorkoutPointRow, WorkoutRow } from '@/db/queries';
import { SignInGate } from '@/features/social/SignInGate';
import { buildWatchPost, canShareToRogo, hrSeries, routePairs } from '@/features/social/watchPost';
import { errorMessage } from '@/format';
import { HIT, spacing, useColors } from '@/theme';

/** JoyoRogo's limit for a post caption. */
const CAPTION_MAX = 1000;

const VISIBILITY = [
  { value: 'grup', label: 'Group' },
  { value: 'publik', label: 'Public' },
] as const;

const VISIBILITY_HINT: Record<RogoVisibility, string> = {
  grup: 'Only people who share a JoyoRogo group with you.',
  publik: 'Anyone on JoyoRogo. Your JoyoRogo profile has to be public.',
};

interface Props {
  workout: WorkoutRow;
  points: readonly WorkoutPointRow[];
}

/**
 * "Share to JoyoRogo" for a workout and the composer it opens: a caption, who may see it, and whether the heart-rate
 * chart and the route go along. Free for everyone to share; JoyoRogo decides who may view the detail. Renders nothing for
 * a workout that may not be shared (see `canShareToRogo`).
 */
export function ShareToRogoButton({ workout, points }: Props) {
  const router = useRouter();
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [visibility, setVisibility] = useState<RogoVisibility>('grup');
  const [includeHr, setIncludeHr] = useState(true);
  const [includeRoute, setIncludeRoute] = useState(true);
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [postedId, setPostedId] = useState<string | null>(null);
  const hasHr = useMemo(() => hrSeries(points, workout.start, workout.end) !== null, [points, workout.start, workout.end]);
  const hasRoute = useMemo(() => routePairs(points) !== null, [points]);

  if (!canShareToRogo(workout)) return null;

  const close = () => {
    setOpen(false);
    setPostedId(null);
    setError(null);
  };

  const post = async () => {
    setPosting(true);
    setError(null);
    try {
      const created = await rogo.social.createWatchPost(buildWatchPost(workout, points, { caption, visibility, includeHr, includeRoute }));
      setCaption('');
      setPostedId(created.id);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setPosting(false);
    }
  };

  return (
    <>
      <Button label="Share to JoyoRogo" icon="people-outline" onPress={() => setOpen(true)} />
      <Modal visible={open} animationType="slide" onRequestClose={close} statusBarTranslucent>
        <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
          <View style={styles.header}>
            <AppText variant="heading" accessibilityRole="header" style={styles.headerTitle}>
              Share to JoyoRogo
            </AppText>
            <PressableScale accessibilityRole="button" accessibilityLabel="Close" onPress={close} style={styles.close}>
              <Ionicons name="close" size={24} color={colors.foreground} />
            </PressableScale>
          </View>
          <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]} keyboardShouldPersistTaps="handled">
            <SignInGate>
              {postedId !== null ? (
                <>
                  <Notice icon="checkmark-circle">Posted to JoyoRogo.</Notice>
                  <Button
                    label="View post"
                    variant="primary"
                    icon="open-outline"
                    onPress={() => {
                      close();
                      router.push({ pathname: '/social/post/[id]', params: { id: postedId } });
                    }}
                  />
                  <Button label="Done" onPress={close} />
                </>
              ) : (
                <>
                  <AppText variant="bodyStrong">{workout.sportName}</AppText>
                  <Field
                    label="Caption"
                    hint="Optional."
                    value={caption}
                    onChangeText={setCaption}
                    maxLength={CAPTION_MAX}
                    multiline
                    style={styles.caption}
                  />
                  <View style={styles.group}>
                    <AppText variant="label" muted>
                      Who can see it
                    </AppText>
                    <Segmented options={VISIBILITY} value={visibility} onChange={setVisibility} />
                    <AppText variant="caption" muted>
                      {VISIBILITY_HINT[visibility]}
                    </AppText>
                  </View>
                  {hasHr ? <SwitchRow label="Heart-rate chart" value={includeHr} onValueChange={setIncludeHr} /> : null}
                  {hasRoute ? (
                    <SwitchRow
                      label="Route"
                      hint="Shows where you started and finished."
                      value={includeRoute}
                      onValueChange={setIncludeRoute}
                    />
                  ) : null}
                  {hasHr || hasRoute ? (
                    <AppText variant="caption" muted>
                      Everyone you share with sees the summary. The heart-rate chart and route are visible to JoyoRogo Pro members and to you.
                    </AppText>
                  ) : null}
                  {error ? <Notice tone="danger">{error}</Notice> : null}
                  <Button label="Post" variant="primary" icon="send" loading={posting} onPress={() => void post()} />
                </>
              )}
            </SignInGate>
          </ScrollView>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { minHeight: HIT, flexDirection: 'row', alignItems: 'center', paddingLeft: spacing.lg, paddingRight: spacing.sm },
  headerTitle: { flex: 1 },
  close: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  group: { gap: spacing.sm },
  caption: { minHeight: 96, paddingVertical: spacing.sm, textAlignVertical: 'top' },
});

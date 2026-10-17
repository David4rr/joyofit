import { Ionicons } from '@expo/vector-icons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useMemo, useRef, useState } from 'react';
import { Modal, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import type { WorkoutRow } from '@/db/queries';
import {
  CARD_WIDTH,
  ShareCard,
  cardHeight,
  type PhotoStatus,
  type ShareBackground,
  type ShareFormat,
} from '@/features/share/ShareCard';
import { captureToFile, copyCardImage, shareCardImage } from '@/features/share/shareImage';
import { buildShareStats, formatShareDate } from '@/features/share/shareStats';
import { sportIcon } from '@/features/workouts/sportIcon';
import type { RoutePoint, WorkoutSummary } from '@/features/workouts/summary';
import { errorMessage } from '@/format';
import { HIT, radius, spacing, useColors } from '@/theme';

/** The card is 1080 px wide; a photo much larger than the card only costs memory. */
const PHOTO_MAX_SIDE = 2400;
const CAPTION = 'Tracked with JoyoFit · https://fit.joyorogo.com';
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };

const FORMATS = [
  { value: 'story', label: 'Story 9:16' },
  { value: 'square', label: 'Square 1:1' },
] as const;

interface Feedback {
  tone: 'info' | 'danger';
  text: string;
}

interface Props {
  workout: WorkoutRow;
  summary: WorkoutSummary;
  route: readonly RoutePoint[];
}

/** The "Share" button of a workout and the full-screen composer it opens. */
export function ShareWorkoutButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button label="Share" icon="share-outline" onPress={() => setOpen(true)} />
      <ShareWorkoutSheet {...props} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

/** Dark checkerboard: the sticker is light text on nothing, so it needs a dark stage to be seen. */
function StickerBackdrop() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="checker" width={20} height={20} patternUnits="userSpaceOnUse">
          <Rect width={20} height={20} fill="#1A1D1B" />
          <Rect width={10} height={10} fill="#2A2F2C" />
          <Rect x={10} y={10} width={10} height={10} fill="#2A2F2C" />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#checker)" />
    </Svg>
  );
}

function ShareWorkoutSheet({
  workout,
  summary,
  route,
  visible,
  onClose,
}: Props & { visible: boolean; onClose: () => void }) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const cardRef = useRef<View>(null);
  const [format, setFormat] = useState<ShareFormat>('story');
  const [background, setBackground] = useState<ShareBackground>('route');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>('loading');
  const [busy, setBusy] = useState<'share' | 'copy' | 'photo' | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const stats = useMemo(() => buildShareStats(workout, summary), [workout, summary]);
  const hasRoute = route.length >= 2;
  const backgrounds: { value: ShareBackground; label: string }[] = [
    { value: 'route', label: hasRoute ? 'Route' : 'Card' },
    { value: 'photo', label: 'Photo' },
    { value: 'sticker', label: 'Sticker' },
  ];

  // The live card keeps its real size and is shrunk from its top-left corner to fill the frame.
  const fullHeight = cardHeight(format);
  const availableWidth = screen.width - spacing.lg * 2;
  const maxFrameHeight = Math.max(screen.height * 0.5, 240);
  const frameWidth = Math.min(availableWidth, (maxFrameHeight * CARD_WIDTH) / fullHeight);
  const scale = frameWidth / CARD_WIDTH;
  const frameHeight = fullHeight * scale;

  const needsPhoto = background === 'photo';
  const ready = !needsPhoto || (photoUri !== null && photoStatus === 'ready');
  const photoFailed = needsPhoto && photoUri !== null && photoStatus === 'error';

  const pickBackground = (next: ShareBackground) => {
    // The photo view remounts when the card comes back to it, so wait for its load again.
    if (next === 'photo') setPhotoStatus('loading');
    setBackground(next);
  };

  const addPhoto = async (source: 'library' | 'camera') => {
    if (busy) return;
    setBusy('photo');
    setFeedback(null);
    try {
      const picked =
        source === 'camera'
          ? await ImagePicker.launchCameraAsync(PICKER_OPTIONS)
          : await ImagePicker.launchImageLibraryAsync(PICKER_OPTIONS);
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0];
      let uri = asset.uri;
      if (Math.max(asset.width, asset.height) > PHOTO_MAX_SIDE) {
        const context = ImageManipulator.manipulate(uri).resize(
          asset.width >= asset.height ? { width: PHOTO_MAX_SIDE } : { height: PHOTO_MAX_SIDE },
        );
        const rendered = await context.renderAsync();
        uri = (await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.92 })).uri;
      }
      setPhotoStatus('loading');
      setPhotoUri(uri);
    } catch (e) {
      setFeedback({
        tone: 'danger',
        text: `Could not ${source === 'camera' ? 'take' : 'load'} the photo: ${errorMessage(e)}`,
      });
    } finally {
      setBusy(null);
    }
  };

  const run = async (action: 'share' | 'copy') => {
    const card = cardRef.current;
    if (!card || busy) return;
    setBusy(action);
    setFeedback(null);
    try {
      if (action === 'share') {
        await shareCardImage(await captureToFile(card), CAPTION);
      } else {
        await copyCardImage(card);
        setFeedback({ tone: 'info', text: 'Image copied. Paste it into your Story, a chat or a note.' });
      }
    } catch (e) {
      setFeedback({ tone: 'danger', text: `Could not ${action === 'share' ? 'share' : 'copy'} the image: ${errorMessage(e)}` });
    } finally {
      setBusy(null);
    }
  };

  const hint =
    background === 'route'
      ? hasRoute
        ? 'Your route and numbers on a dark JoyoFit card.'
        : 'Your numbers on a dark JoyoFit card. This workout has no GPS route.'
      : background === 'photo'
        ? 'Your photo with the numbers on top.'
        : 'A transparent PNG. Copy it, then paste it over your own photo in an Instagram Story.';

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="heading" accessibilityRole="header" style={styles.headerTitle}>
            Share workout
          </AppText>
          <PressableScale accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Segmented options={backgrounds} value={background} onChange={pickBackground} />
          <Segmented options={FORMATS} value={format} onChange={setFormat} />

          <View style={[styles.stage, { backgroundColor: colors.muted }]}>
            <View style={{ width: frameWidth, height: frameHeight, borderRadius: radius.input, overflow: 'hidden' }}>
              {background === 'sticker' ? <StickerBackdrop /> : null}
              {needsPhoto && photoUri === null ? (
                <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: colors.card }]}>
                  <Ionicons name="image-outline" size={40} color={colors.mutedForeground} />
                  <AppText variant="caption" muted style={styles.centered}>
                    Pick a photo from your gallery or take one.
                  </AppText>
                </View>
              ) : (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: CARD_WIDTH,
                    height: fullHeight,
                    transform: [{ scale }],
                    transformOrigin: 'top left',
                  }}>
                  <View ref={cardRef} collapsable={false}>
                    <ShareCard
                      format={format}
                      background={background}
                      title={workout.sportName}
                      subtitle={formatShareDate(workout.start)}
                      icon={sportIcon(workout.sportName)}
                      stats={stats}
                      route={route}
                      photoUri={photoUri}
                      onPhotoStatus={setPhotoStatus}
                    />
                  </View>
                </View>
              )}
            </View>
          </View>

          <AppText variant="caption" muted style={styles.centered}>
            {hint}
          </AppText>

          {needsPhoto ? (
            <View style={styles.row}>
              <Button
                label={photoUri ? 'Change photo' : 'Choose photo'}
                icon="images-outline"
                loading={busy === 'photo'}
                onPress={() => void addPhoto('library')}
                style={styles.flex}
              />
              <Button label="Take photo" icon="camera-outline" disabled={busy !== null} onPress={() => void addPhoto('camera')} style={styles.flex} />
            </View>
          ) : null}

          {photoFailed ? <Notice tone="danger">That photo could not be loaded. Pick another one.</Notice> : null}
          {feedback ? (
            <Notice tone={feedback.tone} icon={feedback.tone === 'info' ? 'checkmark-circle' : undefined}>
              {feedback.text}
            </Notice>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md), borderTopColor: colors.hairline }]}>
          <Button
            label="Copy image"
            icon="copy-outline"
            loading={busy === 'copy'}
            disabled={!ready || busy !== null}
            onPress={() => void run('copy')}
            style={styles.flex}
          />
          <Button
            label="Share"
            icon="share-outline"
            variant="primary"
            loading={busy === 'share'}
            disabled={!ready || busy !== null}
            onPress={() => void run('share')}
            style={styles.flex}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    minHeight: HIT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
  },
  headerTitle: { flex: 1 },
  close: { width: HIT, height: HIT, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.lg, gap: spacing.md },
  stage: {
    borderRadius: radius.card,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  placeholder: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm, padding: spacing.lg },
  centered: { textAlign: 'center' },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

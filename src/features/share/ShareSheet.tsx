import { Ionicons } from '@expo/vector-icons';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Linking, Modal, Platform, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Pattern, Rect } from 'react-native-svg';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import type { IconName } from '@/components/IconChip';
import { PopIn, useFlash } from '@/components/motion';
import { PressableScale } from '@/components/PressableScale';
import { Segmented } from '@/components/Segmented';
import { Notice } from '@/components/States';
import { useToast } from '@/components/Toast';
import { InstagramGlyph } from '@/features/share/InstagramGlyph';
import {
  CARD_WIDTH,
  ShareCard,
  cardHeight,
  type PhotoStatus,
  type ShareBackground,
  type ShareFormat,
} from '@/features/share/ShareCard';
import {
  PhotosDeniedError,
  captureToFile,
  copyCardImage,
  instagramInstalled,
  saveCardImage,
  shareCardImage,
  shareToInstagram,
  type PhotosPrompt,
} from '@/features/share/shareImage';
import type { ShareStat } from '@/features/share/shareStats';
import { canSaveToLibrary } from '@/features/share/shareTargets';
import type { RoutePoint } from '@/features/workouts/summary';
import { errorMessage } from '@/format';
import { HIT, overlay, spacing, useTheme } from '@/theme';

/** The card is 1080 px wide; a photo much larger than the card only costs memory. */
const PHOTO_MAX_SIDE = 2400;
const PICKER_OPTIONS: ImagePicker.ImagePickerOptions = { mediaTypes: ['images'], quality: 1 };
/** Android 11 (API 30) is the first release where saving to Pictures needs no storage permission. */
const SAVE_AVAILABLE = canSaveToLibrary(Platform.OS === 'ios' ? 'ios' : 'android', Platform.OS === 'android' ? Number(Platform.Version) : 0);

type Target = 'instagram' | 'copy' | 'save' | 'more';

interface Feedback {
  tone: 'info' | 'danger';
  text: string;
  action?: { label: string; onPress: () => void };
}

/** What the sheet draws and sends: a workout or a day. */
export interface ShareSubject {
  heading: string;
  title: string;
  subtitle: string;
  icon: IconName;
  stats: readonly ShareStat[];
  /** GPS points for the route silhouette; empty for a day or an indoor workout. */
  route: readonly RoutePoint[];
  /** Text that travels with the image in the system share sheet. */
  caption: string;
  /** One line under the preview for the dark card without a route. */
  cardHint: string;
  /** A line on the card above the wordmark (a workout's gear), when there is one. */
  extraLine?: string | null;
  /** Draws the card itself instead of `ShareCard` (a strength workout's sets); `stats` and `route` are then ignored. */
  renderCard?: (props: SubjectCardProps) => ReactNode;
}

/** What the sheet hands a custom card: the chosen format and background, and the photo with its load callback. */
export interface SubjectCardProps {
  format: ShareFormat;
  background: ShareBackground;
  photoUri: string | null;
  onPhotoStatus: (status: PhotoStatus) => void;
}

/** Dark checkerboard: the sticker is light text on nothing, so it needs a dark stage to be seen. */
function StickerBackdrop() {
  return (
    <Svg width="100%" height="100%" style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="checker" width={20} height={20} patternUnits="userSpaceOnUse">
          <Rect width={20} height={20} fill={overlay.checkerDark} />
          <Rect width={10} height={10} fill={overlay.checkerLight} />
          <Rect x={10} y={10} width={10} height={10} fill={overlay.checkerLight} />
        </Pattern>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#checker)" />
    </Svg>
  );
}

interface TargetButtonProps {
  label: string;
  icon: ReactNode;
  loading: boolean;
  /** A check in place of the icon: the target just worked. */
  done?: boolean;
  disabled: boolean;
  onPress: () => void;
}

/** One big share target: round icon over a label, as in Strava's share row. */
function TargetButton({ label, icon, loading, done = false, disabled, onPress }: TargetButtonProps) {
  const { colors, fonts, radius } = useTheme();
  return (
    <PressableScale
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, busy: loading }}
      disabled={disabled || loading}
      onPress={onPress}
      style={[styles.target, { backgroundColor: colors.muted, borderRadius: radius.card }]}>
      <View style={[styles.targetIcon, { backgroundColor: colors.card }]}>
        {loading ? (
          <ActivityIndicator size="small" color={colors.foreground} />
        ) : done ? (
          <PopIn>
            <Ionicons name="checkmark" size={24} color={colors.primary} />
          </PopIn>
        ) : (
          icon
        )}
      </View>
      <AppText variant="label" numberOfLines={1} style={{ fontFamily: fonts.bold }}>
        {label}
      </AppText>
    </PressableScale>
  );
}

interface PhotosRequest {
  purpose: 'save' | 'instagram';
  answer: (continues: boolean) => void;
}

/** Full-screen composer: template and format pickers, the live card, and the Instagram, Copy, Save and More targets. */
export function ShareSheet({ subject, visible, onClose }: { subject: ShareSubject; visible: boolean; onClose: () => void }) {
  const { colors, radius } = useTheme();
  const { t } = useTranslation(['sharing', 'common']);
  const insets = useSafeAreaInsets();
  const screen = useWindowDimensions();
  const { toast, show } = useToast();
  const cardRef = useRef<View>(null);
  const [format, setFormat] = useState<ShareFormat>('story');
  const [background, setBackground] = useState<ShareBackground>('route');
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<PhotoStatus>('loading');
  const [busy, setBusy] = useState<Target | 'photo' | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [installed, setInstalled] = useState(false);
  const [photosRequest, setPhotosRequest] = useState<PhotosRequest | null>(null);
  const [copied, flashCopied] = useFlash(1400);
  const [saved, flashSaved] = useFlash(1400);

  useEffect(() => {
    if (visible) void instagramInstalled().then(setInstalled);
  }, [visible]);

  const { route } = subject;
  const hasRoute = route.length >= 2;
  const backgrounds: { value: ShareBackground; label: string }[] = [
    { value: 'route', label: hasRoute ? t('sharing:share.backgrounds.route') : t('sharing:share.backgrounds.card') },
    { value: 'photo', label: t('sharing:share.backgrounds.photo') },
    { value: 'sticker', label: t('sharing:share.backgrounds.sticker') },
  ];
  const formats: { value: ShareFormat; label: string }[] = [
    { value: 'story', label: t('sharing:share.formats.story') },
    { value: 'square', label: t('sharing:share.formats.square') },
  ];

  // The live card keeps its real size and is shrunk from its top-left corner to fill the frame.
  const fullHeight = cardHeight(format);
  const availableWidth = screen.width - spacing.lg * 2;
  const maxFrameHeight = Math.max(screen.height * 0.45, 240);
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
        text: t(source === 'camera' ? 'sharing:share.errors.photoTake' : 'sharing:share.errors.photoLoad', { error: errorMessage(e) }),
      });
    } finally {
      setBusy(null);
    }
  };

  /** Our own "Continue" dialog goes first, so the system Photos dialog is never a surprise. */
  const askPhotos: PhotosPrompt = (purpose) => {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    setPhotosRequest({ purpose, answer: resolve });
    return promise;
  };

  const answerPhotos = (continues: boolean) => {
    photosRequest?.answer(continues);
    setPhotosRequest(null);
  };

  const run = async (target: Target) => {
    const card = cardRef.current;
    if (!card || busy) return;
    setBusy(target);
    setFeedback(null);
    try {
      if (target === 'copy') {
        await copyCardImage(card);
        show(t('sharing:share.toasts.copied'));
        flashCopied();
      } else if (target === 'more') {
        await shareCardImage(await captureToFile(card), subject.caption);
      } else if (target === 'save') {
        if (await saveCardImage(await captureToFile(card), askPhotos)) {
          show(t('sharing:share.toasts.saved'));
          flashSaved();
        }
      } else {
        await shareToInstagram(await captureToFile(card), background, subject.caption, askPhotos);
      }
    } catch (e) {
      if (e instanceof PhotosDeniedError) {
        setFeedback({ tone: 'danger', text: e.message, action: { label: t('sharing:share.errors.openSettings'), onPress: () => void Linking.openSettings() } });
      } else {
        const key = target === 'copy' ? 'copy' : target === 'save' ? 'save' : 'share';
        setFeedback({ tone: 'danger', text: t(`sharing:share.errors.${key}`, { error: errorMessage(e) }) });
      }
    } finally {
      setBusy(null);
    }
  };

  const hint =
    background === 'route'
      ? hasRoute
        ? t('sharing:share.hints.route')
        : subject.cardHint
      : background === 'photo'
        ? t('sharing:share.hints.photo')
        : t('sharing:share.hints.sticker');

  const idle = ready && busy === null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={[styles.root, { backgroundColor: colors.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <AppText variant="heading" accessibilityRole="header" style={styles.headerTitle}>
            {subject.heading}
          </AppText>
          <PressableScale accessibilityRole="button" accessibilityLabel={t('common:actions.close')} onPress={onClose} style={styles.close}>
            <Ionicons name="close" size={24} color={colors.foreground} />
          </PressableScale>
        </View>

        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Segmented options={backgrounds} value={background} onChange={pickBackground} />
          <Segmented options={formats} value={format} onChange={setFormat} />

          <View style={[styles.stage, { backgroundColor: colors.muted, borderRadius: radius.card }]}>
            <View style={{ width: frameWidth, height: frameHeight, borderRadius: radius.input, overflow: 'hidden' }}>
              {background === 'sticker' ? <StickerBackdrop /> : null}
              {needsPhoto && photoUri === null ? (
                <View style={[StyleSheet.absoluteFill, styles.placeholder, { backgroundColor: colors.card }]}>
                  <Ionicons name="image-outline" size={40} color={colors.mutedForeground} />
                  <AppText variant="caption" muted style={styles.centered}>
                    {t('sharing:share.photoPlaceholder')}
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
                    {subject.renderCard ? (
                      subject.renderCard({ format, background, photoUri, onPhotoStatus: setPhotoStatus })
                    ) : (
                      <ShareCard
                        format={format}
                        background={background}
                        title={subject.title}
                        subtitle={subject.subtitle}
                        icon={subject.icon}
                        stats={subject.stats}
                        route={route}
                        photoUri={photoUri}
                        onPhotoStatus={setPhotoStatus}
                        extraLine={subject.extraLine}
                      />
                    )}
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
                label={photoUri ? t('sharing:share.photoChange') : t('sharing:share.photoChoose')}
                icon="images-outline"
                loading={busy === 'photo'}
                onPress={() => void addPhoto('library')}
                style={styles.flex}
              />
              <Button label={t('sharing:share.photoTake')} icon="camera-outline" disabled={busy !== null} onPress={() => void addPhoto('camera')} style={styles.flex} />
            </View>
          ) : null}

          {photoFailed ? <Notice tone="danger">{t('sharing:share.photoFailed')}</Notice> : null}
          {feedback ? (
            <Notice tone={feedback.tone} action={feedback.action}>
              {feedback.text}
            </Notice>
          ) : null}
        </ScrollView>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, spacing.md), borderTopColor: colors.hairline }]}>
          {installed ? (
            <TargetButton label={t('sharing:share.targets.instagram')} icon={<InstagramGlyph size={24} color={colors.foreground} />} loading={busy === 'instagram'} disabled={!idle} onPress={() => void run('instagram')} />
          ) : null}
          <TargetButton label={t('sharing:share.targets.copy')} icon={<Ionicons name="copy-outline" size={24} color={colors.foreground} />} loading={busy === 'copy'} done={copied} disabled={!idle} onPress={() => void run('copy')} />
          {SAVE_AVAILABLE ? (
            <TargetButton label={t('sharing:share.targets.save')} icon={<Ionicons name="download-outline" size={24} color={colors.foreground} />} loading={busy === 'save'} done={saved} disabled={!idle} onPress={() => void run('save')} />
          ) : null}
          <TargetButton label={t('sharing:share.targets.more')} icon={<Ionicons name="share-outline" size={24} color={colors.foreground} />} loading={busy === 'more'} disabled={!idle} onPress={() => void run('more')} />
        </View>

        {toast}
      </View>

      <ConfirmDialog
        visible={photosRequest !== null}
        title={t('sharing:share.photosDialog.title')}
        message={
          photosRequest?.purpose === 'instagram'
            ? t('sharing:share.photosDialog.instagram')
            : t('sharing:share.photosDialog.save')
        }
        confirmLabel={t('sharing:share.photosDialog.confirm')}
        cancelLabel={t('sharing:share.photosDialog.cancel')}
        onConfirm={() => answerPhotos(true)}
        onCancel={() => answerPhotos(false)}
      />
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
  target: { flex: 1, minHeight: 84, alignItems: 'center', justifyContent: 'center', gap: spacing.sm, paddingVertical: spacing.md },
  targetIcon: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
});

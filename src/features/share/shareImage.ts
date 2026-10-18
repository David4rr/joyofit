import Constants from 'expo-constants';
import * as Clipboard from 'expo-clipboard';
import * as MediaLibrary from 'expo-media-library';
import { Linking, Platform, type View } from 'react-native';
import Share, { Social } from 'react-native-share';
import { captureRef } from 'react-native-view-shot';

import type { ShareBackground } from '@/features/share/ShareCard';
import { t } from '@/i18n';
import { instagramRoute, resolveFacebookAppId, type InstagramRoute } from '@/features/share/shareTargets';

/** Resolves after the next frame, so a just-loaded photo has been drawn once. */
function nextFrame(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  requestAnimationFrame(() => resolve());
  return promise;
}

/**
 * Lets Android draw the decoded photo bitmap before `view.draw()`; the caller has already waited for the
 * image's `onLoad`.
 */
async function settle(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

/** Renders the mounted card to a PNG in the cache (`file://` URI). A card without a background keeps its alpha. */
export async function captureToFile(card: View): Promise<string> {
  await settle();
  return captureRef(card, { format: 'png', result: 'tmpfile', quality: 1 });
}

/** Puts the card on the clipboard as a PNG, so it can be pasted over a Story or into a chat. */
export async function copyCardImage(card: View): Promise<void> {
  await settle();
  const base64 = await captureRef(card, { format: 'png', result: 'base64', quality: 1 });
  await Clipboard.setImageAsync(base64);
}

/** Some Android share targets report a dismissal as an error; that is not a failure. */
function isShareCancel(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|User did not share|does not respond/i.test(message);
}

/** Opens the system share sheet with the PNG; resolves quietly when the user closes the sheet. */
export async function shareCardImage(fileUri: string, caption: string): Promise<void> {
  try {
    await Share.open({ url: fileUri, type: 'image/png', message: caption, failOnCancel: false });
  } catch (error) {
    if (!isShareCancel(error)) throw error;
  }
}

/**
 * Facebook App ID of the "JoyoDigitama" Meta app (shared with JoyoRogo), from `EXPO_PUBLIC_FB_APP_ID` at build time or
 * `expo.extra.facebookAppId`. Instagram needs it as `source_application` to open its Story composer directly; without
 * it the Instagram button hands the PNG to the Instagram app's share target instead.
 */
const FACEBOOK_APP_ID = resolveFacebookAppId(
  process.env.EXPO_PUBLIC_FB_APP_ID,
  (Constants.expoConfig?.extra as { facebookAppId?: string } | undefined)?.facebookAppId,
);

const OS = Platform.OS === 'ios' ? 'ios' : 'android';

/** Android asks the package manager, iOS asks whether the `instagram` scheme opens (listed in `LSApplicationQueriesSchemes` by the react-native-share plugin). */
export async function instagramInstalled(): Promise<boolean> {
  try {
    if (OS === 'android') return (await Share.isPackageInstalled('com.instagram.android')).isInstalled;
    return await Linking.canOpenURL('instagram://app');
  } catch {
    return false;
  }
}

/** Photos access is off and cannot be asked for again; only the system Settings can turn it on. */
export class PhotosDeniedError extends Error {
  constructor() {
    super(t('sharing:share.errors.photosDenied'));
  }
}

/** Asked before the system dialog so the person knows why; resolves `false` when they back out. */
export type PhotosPrompt = (purpose: 'save' | 'instagram') => Promise<boolean>;

/**
 * Photos permission on iOS: add-only for Save, read-write for Instagram's iOS share path (it saves the image to Photos
 * and opens it by id). Android needs none for these. Resolves `false` when the person declines the pre-prompt; throws
 * `PhotosDeniedError` when iOS will not ask again or the system dialog is refused.
 */
async function ensurePhotosAccess(purpose: 'save' | 'instagram', prompt: PhotosPrompt): Promise<boolean> {
  if (OS === 'android') return true;
  const writeOnly = purpose === 'save';
  const current = await MediaLibrary.getPermissionsAsync(writeOnly);
  if (current.granted) return true;
  if (!current.canAskAgain) throw new PhotosDeniedError();
  if (!(await prompt(purpose))) return false;
  if (!(await MediaLibrary.requestPermissionsAsync(writeOnly)).granted) throw new PhotosDeniedError();
  return true;
}

/** Adds the PNG to the photo library (Photos on iOS, Pictures on Android). Resolves `false` when the person declines the pre-prompt. */
export async function saveCardImage(fileUri: string, prompt: PhotosPrompt): Promise<boolean> {
  if (!(await ensurePhotosAccess('save', prompt))) return false;
  await MediaLibrary.Asset.create(fileUri);
  return true;
}

/**
 * Instagram button. With a Facebook App ID the Story composer opens directly: the transparent sticker goes in as
 * `stickerImage` (placed over the person's own Story), the route and photo cards as the full-bleed `backgroundImage`.
 * Without one the PNG goes to the Instagram app's share target, where the person picks Story or post. Returns the route
 * taken, or `null` when the person backed out of the Photos pre-prompt.
 */
export async function shareToInstagram(
  fileUri: string,
  background: ShareBackground,
  caption: string,
  prompt: PhotosPrompt,
): Promise<InstagramRoute | null> {
  const route = instagramRoute(FACEBOOK_APP_ID, OS, background);
  try {
    if (route === 'stories' && FACEBOOK_APP_ID) {
      await Share.shareSingle({
        social: Social.InstagramStories,
        appId: FACEBOOK_APP_ID,
        ...(background === 'sticker' ? { stickerImage: fileUri } : { backgroundImage: fileUri }),
      });
    } else if (route === 'instagram') {
      if (OS === 'ios' && !(await ensurePhotosAccess('instagram', prompt))) return null;
      await Share.shareSingle({ social: Social.Instagram, url: fileUri, type: 'image/png' });
    } else {
      await shareCardImage(fileUri, caption);
    }
  } catch (error) {
    if (!isShareCancel(error)) throw error;
  }
  return route;
}

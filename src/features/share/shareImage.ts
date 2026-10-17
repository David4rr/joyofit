import * as Clipboard from 'expo-clipboard';
import { Linking, Platform, type View } from 'react-native';
import Share, { Social } from 'react-native-share';
import { captureRef } from 'react-native-view-shot';

import type { ShareBackground } from '@/features/share/ShareCard';

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

/** Facebook App ID of the "JoyoDigitama" Meta app (shared with JoyoRogo). Public: Instagram needs it as `source_application`. */
const INSTAGRAM_APP_ID = '1016598258111944';

/** Android asks the package manager, iOS asks whether the `instagram-stories` scheme opens (listed in `LSApplicationQueriesSchemes` by the plugin). */
async function instagramInstalled(): Promise<boolean> {
  try {
    if (Platform.OS === 'android') return (await Share.isPackageInstalled('com.instagram.android')).isInstalled;
    return await Linking.canOpenURL('instagram-stories://share');
  } catch {
    return false;
  }
}

/**
 * Opens Instagram's Story composer with the PNG. The transparent sticker goes in as `stickerImage` (the user places
 * it over their own Story), the route and photo cards as the full-bleed `backgroundImage`. Without Instagram the system
 * share sheet takes the PNG instead; returns `false` in that case so the caller can say so.
 */
export async function shareToInstagramStory(
  fileUri: string,
  background: ShareBackground,
  caption: string,
): Promise<boolean> {
  if (!(await instagramInstalled())) {
    await shareCardImage(fileUri, caption);
    return false;
  }
  try {
    await Share.shareSingle({
      social: Social.InstagramStories,
      appId: INSTAGRAM_APP_ID,
      ...(background === 'sticker' ? { stickerImage: fileUri } : { backgroundImage: fileUri }),
    });
  } catch (error) {
    if (!isShareCancel(error)) throw error;
  }
  return true;
}

import * as Clipboard from 'expo-clipboard';
import type { View } from 'react-native';
import Share from 'react-native-share';
import { captureRef } from 'react-native-view-shot';

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

/** Opens the system share sheet with the PNG; resolves quietly when the user closes the sheet. */
export async function shareCardImage(fileUri: string, caption: string): Promise<void> {
  try {
    await Share.open({ url: fileUri, type: 'image/png', message: caption, failOnCancel: false });
  } catch (error) {
    // Some Android share targets report a dismissal as an error.
    const message = error instanceof Error ? error.message : String(error);
    if (!/cancel|User did not share|does not respond/i.test(message)) throw error;
  }
}

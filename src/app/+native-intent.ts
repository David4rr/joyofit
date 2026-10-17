import { readHead } from '@/features/sharedfile/readHead';
import { classifyByName, screenFor, sniffKind } from '@/features/sharedfile/routeSharedFile';

/**
 * A file opened with or shared to JoyoFit arrives as a `content://` (Android) or `file://` (iOS) URL. Expo Router would
 * look for a route with that path and show "unmatched route", so the URL goes to an import screen instead: a Huawei
 * Privacy Centre export `.zip` to the Huawei import, a `.fit` file (and anything unclear) to the FIT import. The
 * extension decides first; when the name says nothing (a download provider's `msf:123`, an octet-stream attachment) the
 * first bytes do. On Android a shared file is first turned into a view intent by `plugins/with-shared-fit.js`. Every
 * other URL (the `joyofit://` links) is left alone.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (!/^(content|file):\/\//i.test(path)) return path;
  const named = classifyByName(path);
  const kind = named !== 'unknown' ? named : sniffKind(readHead(path) ?? new Uint8Array(0));
  return screenFor(path, kind);
}

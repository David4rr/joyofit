/**
 * A `.fit` file opened with or shared to JoyoFit arrives as a `content://` (Android) or `file://` (iOS) URL. Expo Router
 * would look for a route with that path and show "unmatched route", so the URL goes to the FIT import screen instead,
 * which imports the file it names. On Android a shared file is first turned into a view intent by
 * `plugins/with-shared-fit.js`. Every other URL (the `joyofit://` links) is left alone.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (/^(content|file):\/\//i.test(path)) return `/settings/import-fit?uri=${encodeURIComponent(path)}`;
  return path;
}

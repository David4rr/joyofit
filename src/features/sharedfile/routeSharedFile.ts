export type SharedFileKind = 'fit' | 'huawei-zip' | 'gpx' | 'tcx' | 'unknown';

const ZIP_MIME = /^application\/(zip|x-zip-compressed|x-zip)$/i;
const FIT_MIME = /^application\/(vnd\.ant\.fit|x-fit)$/i;
const GPX_MIME = /^application\/(x-)?gpx(\+xml)?$/i;
const TCX_MIME = /^application\/(vnd\.garmin\.tcx\+xml|x-tcx\+xml|tcx)$/i;

/**
 * Bytes read from the start of a file to tell what it is: a ZIP starts with `PK`, a FIT file has `.FIT` at offset 8, and
 * a GPX or TCX file names its root element (`<gpx`, `<TrainingCenterDatabase`) after an XML declaration, comments and
 * the namespace attributes of Garmin's and Strava's headers, well within the first kilobyte.
 */
export const SNIFF_BYTES = 1024;

const XML_ROOT = /<(?:[\w.-]+:)?(gpx|trainingcenterdatabase)[\s>/]/;

/** The decoded last path segment of a `content://` or `file://` URL (or a bare file name). */
function fileNameOf(uri: string): string {
  const path = uri.split(/[?#]/)[0];
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  return decoded.split(/[/:]/).pop() ?? '';
}

/** The file extension of the last path segment of a `content://` or `file://` URL, lower case, without the dot. */
export function extensionOf(uri: string): string | null {
  const name = fileNameOf(uri);
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null;
}

/**
 * The file's own name without its extension (`Lari pagi` from `.../Lari%20pagi.gpx`), for naming a route that has no name
 * inside; null when there is nothing readable, e.g. a download provider's `msf:1234`.
 */
export function baseNameOf(uriOrName: string): string | null {
  const name = fileNameOf(uriOrName);
  const dot = name.lastIndexOf('.');
  const base = (dot >= 0 ? name.slice(0, dot) : name).trim();
  return base === '' || /^\d+$/.test(base) ? null : base;
}

/** GPX or TCX from the root element of an XML file's first bytes; `unknown` for XML of any other kind and for anything that does not start like XML. */
function sniffXml(head: Uint8Array): SharedFileKind {
  const start = head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
  let text = '';
  for (let i = start; i < head.length && i < SNIFF_BYTES; i++) text += String.fromCharCode(head[i]);
  const lowered = text.trimStart().toLowerCase();
  if (!lowered.startsWith('<')) return 'unknown';
  const root = XML_ROOT.exec(lowered);
  if (root === null) return 'unknown';
  return root[1] === 'gpx' ? 'gpx' : 'tcx';
}

/** What the first bytes say: a ZIP starts with `PK`, a FIT file has `.FIT` at offset 8, a GPX or TCX file is XML with that root. */
export function sniffKind(head: Uint8Array): SharedFileKind {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && [0x03, 0x05, 0x07].includes(head[2]) && [0x04, 0x06, 0x08].includes(head[3])) {
    return 'huawei-zip';
  }
  if (head.length >= 12 && head[8] === 0x2e && head[9] === 0x46 && head[10] === 0x49 && head[11] === 0x54) return 'fit';
  return sniffXml(head);
}

/**
 * Extension, then MIME type; `unknown` when neither is decisive (octet-stream, no extension, a generic `application/xml`),
 * so the caller sniffs.
 */
export function classifyByName(uri: string, mimeType?: string | null): SharedFileKind {
  const ext = extensionOf(uri);
  if (ext === 'fit') return 'fit';
  if (ext === 'zip') return 'huawei-zip';
  if (ext === 'gpx') return 'gpx';
  if (ext === 'tcx') return 'tcx';
  if (mimeType) {
    if (FIT_MIME.test(mimeType)) return 'fit';
    if (ZIP_MIME.test(mimeType)) return 'huawei-zip';
    if (GPX_MIME.test(mimeType)) return 'gpx';
    if (TCX_MIME.test(mimeType)) return 'tcx';
  }
  return 'unknown';
}

/** The screen a shared file opens: the Huawei export import for a ZIP, the route import for GPX and TCX, the FIT import for everything else. */
export function screenFor(uri: string, kind: SharedFileKind): string {
  const base =
    kind === 'huawei-zip' ? '/settings/import-huawei' : kind === 'gpx' || kind === 'tcx' ? '/routes/import' : '/settings/import-fit';
  return `${base}?uri=${encodeURIComponent(uri)}`;
}

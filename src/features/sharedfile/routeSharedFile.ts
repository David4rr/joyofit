export type SharedFileKind = 'fit' | 'huawei-zip' | 'unknown';

const ZIP_MIME = /^application\/(zip|x-zip-compressed|x-zip)$/i;
const FIT_MIME = /^application\/(vnd\.ant\.fit|x-fit)$/i;

/** Bytes a ZIP starts with: `PK` and a local-file, empty-archive or spanned-archive marker. */
export const SNIFF_BYTES = 12;

/** The file extension of the last path segment of a `content://` or `file://` URL, lower case, without the dot. */
export function extensionOf(uri: string): string | null {
  const path = uri.split(/[?#]/)[0];
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  const name = decoded.split(/[/:]/).pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot > 0 && dot < name.length - 1 ? name.slice(dot + 1).toLowerCase() : null;
}

/** What the first bytes say: a ZIP starts with `PK`, a FIT file has `.FIT` at offset 8. */
export function sniffKind(head: Uint8Array): SharedFileKind {
  if (head.length >= 4 && head[0] === 0x50 && head[1] === 0x4b && [0x03, 0x05, 0x07].includes(head[2]) && [0x04, 0x06, 0x08].includes(head[3])) {
    return 'huawei-zip';
  }
  if (head.length >= 12 && head[8] === 0x2e && head[9] === 0x46 && head[10] === 0x49 && head[11] === 0x54) return 'fit';
  return 'unknown';
}

/** Extension, then MIME type; `unknown` when neither is decisive (octet-stream, no extension), so the caller sniffs. */
export function classifyByName(uri: string, mimeType?: string | null): SharedFileKind {
  const ext = extensionOf(uri);
  if (ext === 'fit') return 'fit';
  if (ext === 'zip') return 'huawei-zip';
  if (mimeType) {
    if (FIT_MIME.test(mimeType)) return 'fit';
    if (ZIP_MIME.test(mimeType)) return 'huawei-zip';
  }
  return 'unknown';
}

/** The screen a shared file opens: Huawei export import for a ZIP, FIT import for everything else. */
export function screenFor(uri: string, kind: SharedFileKind): string {
  const base = kind === 'huawei-zip' ? '/settings/import-huawei' : '/settings/import-fit';
  return `${base}?uri=${encodeURIComponent(uri)}`;
}

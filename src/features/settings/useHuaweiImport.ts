import { useEventListener } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useState } from 'react';

import { holdScreenOn, releaseScreen } from '@/features/strength/keepAwake';
import { errorMessage } from '@/format';
import { t } from '@/i18n';
import { isIos } from '@/components/IosUnavailable';
import { HuaweiWear, type HuaweiImportProgressEvent, type HuaweiImportSummary } from '@/wear';

const KEEP_AWAKE_TAG = 'huawei-import';

export interface PickedExport {
  uri: string;
  name: string;
  /** Bytes, when the provider says. */
  size: number | null;
}

/** What a rejected `importHuaweiExport` means for the user. The native codes are listed in `HuaweiWearModule.ts`. */
export function importErrorMessage(e: unknown): string {
  const code = typeof e === 'object' && e !== null && 'code' in e ? String(e.code) : '';
  switch (code) {
    case 'ERR_IMPORT_PASSWORD':
      return t('settings:huaweiImport.errors.password');
    case 'ERR_IMPORT_FORMAT':
      return t('settings:huaweiImport.errors.format');
    case 'ERR_BUSY':
      return t('settings:huaweiImport.errors.busy');
    default:
      return errorMessage(e);
  }
}

/**
 * State of the "Import from Huawei Health" screen. The ZIP is opened in place (`copyToCacheDirectory: false`): an export
 * can be several GB. The password lives in this hook's state only, is sent to the native import and is cleared when the
 * import succeeds, is cancelled, or the screen goes away; it is never written to storage or logged.
 */
export function useHuaweiImport() {
  const [file, setFile] = useState<PickedExport | null>(null);
  const [password, setPassword] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<HuaweiImportProgressEvent | null>(null);
  const [summary, setSummary] = useState<HuaweiImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEventListener(HuaweiWear, 'onHuaweiImportProgress', (event) => setProgress(event));

  const pick = useCallback(async () => {
    setError(null);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: false });
      if (picked.canceled || picked.assets.length === 0) return;
      const asset = picked.assets[0];
      setFile({ uri: asset.uri, name: asset.name, size: asset.size ?? null });
      setSummary(null);
      setProgress(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);

  /**
   * Preselects a ZIP another app opened with or shared to JoyoFit; the password is still asked for. A `content://` URI ends in an
   * opaque id (`1ec426fd-...`), so the name the sender gave the file comes from the provider (`huaweiExportDisplayName`).
   */
  const select = useCallback((uri: string) => {
    let name = 'Huawei export.zip'; // i18n-ok: fallback file name
    let size: number | null = null;
    try {
      const f = new File(uri);
      name = f.name || name;
      size = f.size ?? null;
    } catch {
      // the import itself reports an unreadable file
    }
    setFile({ uri, name, size });
    setError(null);
    setSummary(null);
    setProgress(null);
    if (!isIos) {
      const apply = (shown: string | null) => {
        if (shown) setFile((current) => (current?.uri === uri ? { ...current, name: shown } : current));
      };
      try {
        void HuaweiWear.huaweiExportDisplayName(uri).then(apply, () => undefined);
      } catch {
        // an older binary has no such call: the name above stays
      }
    }
  }, []);

  const start = useCallback(async () => {
    if (!file || running) return;
    setRunning(true);
    setError(null);
    setSummary(null);
    setProgress(null);
    // A large export takes minutes; a screen that turns off lets the system stop the app mid-import.
    void holdScreenOn(KEEP_AWAKE_TAG);
    try {
      const result = await HuaweiWear.importHuaweiExport(file.uri, password);
      setSummary(result);
      setPassword('');
    } catch (e) {
      setError(importErrorMessage(e));
    } finally {
      void releaseScreen(KEEP_AWAKE_TAG);
      setRunning(false);
    }
  }, [file, password, running]);

  const cancel = useCallback(() => HuaweiWear.cancelHuaweiImport(), []);

  return { file, password, setPassword, running, progress, summary, error, pick, select, start, cancel };
}

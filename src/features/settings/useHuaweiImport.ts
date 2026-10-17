import { useEventListener } from 'expo';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useCallback, useState } from 'react';

import { errorMessage } from '@/format';
import { HuaweiWear, type HuaweiImportProgressEvent, type HuaweiImportSummary } from '@/wear';

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
      return 'That password did not open the ZIP. Use the one you set when you requested your data from Huawei.';
    case 'ERR_IMPORT_FORMAT':
      return 'This file is not a Huawei Health export. Pick the ZIP from the Huawei email, the one with your Health data.';
    case 'ERR_BUSY':
      return 'An import is already running.';
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

  /** Preselects a ZIP another app opened with or shared to JoyoFit; the password is still asked for. */
  const select = useCallback((uri: string) => {
    let name = 'Huawei export.zip';
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
  }, []);

  const start = useCallback(async () => {
    if (!file || running) return;
    setRunning(true);
    setError(null);
    setSummary(null);
    setProgress(null);
    try {
      const result = await HuaweiWear.importHuaweiExport(file.uri, password);
      setSummary(result);
      setPassword('');
    } catch (e) {
      setError(importErrorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [file, password, running]);

  const cancel = useCallback(() => HuaweiWear.cancelHuaweiImport(), []);

  return { file, password, setPassword, running, progress, summary, error, pick, select, start, cancel };
}

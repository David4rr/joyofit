import { useEventListener } from 'expo';
import { useCallback, useState } from 'react';

import { errorMessage } from '@/format';
import { HuaweiWear, type HuaweiImportProgressEvent, type HuaweiImportSummary } from '@/wear';

/**
 * State of the "Import history from Apple Health" screen (iOS only). The read permission is requested by the native import
 * when the user taps the button, not before. Progress comes on the same event as the Huawei ZIP import.
 */
export function useAppleHealthImport() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<HuaweiImportProgressEvent | null>(null);
  const [summary, setSummary] = useState<HuaweiImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEventListener(HuaweiWear, 'onHuaweiImportProgress', (event) => setProgress(event));

  const start = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setSummary(null);
    setProgress(null);
    try {
      setSummary(await HuaweiWear.importAppleHealthHistory());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setRunning(false);
    }
  }, [running]);

  const cancel = useCallback(() => HuaweiWear.cancelHuaweiImport(), []);

  return { running, progress, summary, error, start, cancel };
}

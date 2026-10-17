import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { countNightHrvSince, listSleepSince } from '@/db/queries';
import { useNativeRefresh } from '@/features/settings/useNativeRefresh';
import { countNightsSince, nightHrvAvailability, type NightHrvAvailability } from '@/features/today/nightHrv';
import { HISTORY_DAYS } from '@/features/today/useTodayData';
import { HuaweiWear } from '@/wear';

/** A night that ends just after the calibration started before it. */
const NIGHT_LOOKBACK_SEC = 12 * 3600;

/**
 * Whether night HRV is arriving, null until the first read. Re-read when stored data changes (`dataVersion`, after a
 * sync) and whenever the screen gains focus or the app returns to the foreground, which is when the stress switch or
 * the watch's supported commands may have changed.
 */
export function useNightHrvAvailability(dataVersion: number): NightHrvAvailability | null {
  const db = useSQLiteContext();
  const [availability, setAvailability] = useState<NightHrvAvailability | null>(null);
  const latest = useRef(0);

  const refresh = useCallback(() => {
    const request = ++latest.current;
    const status = HuaweiWear.getStressStatus();
    const nowSec = Math.floor(Date.now() / 1000);
    const windowStart = nowSec - (HISTORY_DAYS + 1) * 86400;
    const setupStart = status.lastCalibratedAt ?? windowStart;
    Promise.all([
      countNightHrvSince(db, windowStart),
      countNightHrvSince(db, setupStart),
      listSleepSince(db, setupStart - NIGHT_LOOKBACK_SEC),
    ]).then(
      ([inWindow, sinceSetup, sleep]) => {
        if (request !== latest.current) return;
        setAvailability(
          nightHrvAvailability({
            platform: Platform.OS === 'ios' ? 'ios' : 'android',
            knownSupported: status.knownSupported,
            enabled: status.enabled,
            calibratedAt: status.lastCalibratedAt,
            nightsSinceSetup: countNightsSince(sleep, [], status.lastCalibratedAt ?? windowStart),
            nightRowsSinceSetup: sinceSetup,
            anyNightRowInHistory: inWindow > 0,
          }),
        );
      },
      // Without the counts the old text is shown, which is what happened before this hook existed.
      () => {
        if (request === latest.current) setAvailability(null);
      },
    );
  }, [db]);

  useNativeRefresh(refresh);
  useEffect(() => {
    refresh();
  }, [refresh, dataVersion]);

  return availability;
}

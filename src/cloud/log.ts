import { pushLog } from '@/state/logStore';

/** A line of the in-app log (Settings, Advanced) for the cloud sync. */
export const cloudLog = (message: string, direction: 'info' | 'error' = 'info') =>
  pushLog({ ts: Date.now(), direction, serviceId: null, commandId: null, hex: null, message: `cloud: ${message}` });

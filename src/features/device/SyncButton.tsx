import { useTranslation } from 'react-i18next';

import { Button } from '@/components/Button';
import { useSyncDone } from '@/features/device/useSyncDone';
import { useWatch } from '@/state/WatchProvider';

interface SyncButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'inverse';
}

/** "Sync now" for the connected watch: a spinner while it runs, then a check and "Synced" for a moment. */
export function SyncButton({ variant = 'secondary' }: SyncButtonProps) {
  const { t } = useTranslation('watch');
  const { linkState, device, lastSync, sync } = useWatch();
  const syncing = linkState === 'syncing';
  const done = useSyncDone(syncing, lastSync);
  return (
    <Button
      label={syncing ? t('device.sync.syncing') : done ? t('device.sync.done') : t('device.sync.now')}
      variant={variant}
      icon="sync"
      disabled={linkState !== 'connected' || device === null}
      loading={syncing}
      done={done}
      onPress={() => void sync()}
    />
  );
}

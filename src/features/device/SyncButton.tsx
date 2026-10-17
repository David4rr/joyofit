import { Button } from '@/components/Button';
import { useSyncDone } from '@/features/device/useSyncDone';
import { useWatch } from '@/state/WatchProvider';

interface SyncButtonProps {
  variant?: 'primary' | 'secondary' | 'ghost' | 'inverse';
}

/** "Sync now" for the connected watch: a spinner while it runs, then a check and "Synced" for a moment. */
export function SyncButton({ variant = 'secondary' }: SyncButtonProps) {
  const { linkState, device, lastSync, sync } = useWatch();
  const syncing = linkState === 'syncing';
  const done = useSyncDone(syncing, lastSync);
  return (
    <Button
      label={syncing ? 'Syncing' : done ? 'Synced' : 'Sync now'}
      variant={variant}
      icon="sync"
      disabled={linkState !== 'connected' || device === null}
      loading={syncing}
      done={done}
      onPress={() => void sync()}
    />
  );
}

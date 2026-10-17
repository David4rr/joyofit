import { useIsFocused } from 'expo-router';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { isIos } from '@/components/IosUnavailable';
import { useWatch } from '@/state/WatchProvider';

/**
 * Asks before a first bind (ERR_BIND_CONFIRMATION): binding replaces the watch's current phone pairing. Shown by the Watch tab and by
 * the setup guide, whichever is on screen (both stay mounted in the tab navigator); `confirmBind` then connects again and the watch
 * asks for its own accept.
 */
export function BindConfirmDialog() {
  const watch = useWatch();
  const focused = useIsFocused();
  return (
    <ConfirmDialog
      visible={focused && watch.bindRequest !== null}
      title="Pair this watch with this phone?"
      message={
        `This watch is not paired with this ${isIos ? 'iPhone' : 'phone'} yet. A watch keeps one phone pairing, so continuing replaces ` +
        'the pairing with your other phone or app (Huawei Health, or JoyoFit on another phone), which will have to pair again. ' +
        'You will then confirm on the watch.'
      }
      confirmLabel="Continue"
      onConfirm={() => void watch.confirmBind()}
      onCancel={watch.cancelBind}
    />
  );
}

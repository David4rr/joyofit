import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from '@/components/ConfirmDialog';
import { isIos } from '@/components/IosUnavailable';
import { useCloud } from '@/state/CloudProvider';

interface AccountDialogs {
  askSignOut: () => void;
  askDelete: () => void;
  /** Render once, anywhere on the screen. */
  dialogs: ReactNode;
}

/**
 * The two account-level actions of the Settings hub, each behind its own confirm dialog: sign out, and delete the
 * JoyoRogo account (which also wipes its cloud data). The one implementation of both; "Delete cloud data", which keeps
 * the account, lives with the cloud settings.
 */
export function useAccountDialogs(): AccountDialogs {
  const { t } = useTranslation('settings');
  const cloud = useCloud();
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // Set once a delete has been tried, so a failure shows its reason inside the dialog that stays open.
  const [tried, setTried] = useState(false);
  const withApple = isIos && cloud.appleAvailable;

  const closeDelete = () => {
    setDeleting(false);
    setTried(false);
  };

  const deleteMessage = [t('cloud.deleteWarning'), withApple ? t('cloud.deleteApple') : null, tried && !cloud.deleting ? cloud.error : null]
    .filter(Boolean)
    .join(' ');

  const dialogs = (
    <>
      <ConfirmDialog
        visible={signingOut}
        title={t('account.signOutTitle')}
        message={t('account.signOutMessage')}
        confirmLabel={t('cloud.signOut')}
        destructive
        onConfirm={() => {
          setSigningOut(false);
          void cloud.signOut();
        }}
        onCancel={() => setSigningOut(false)}
      />
      <ConfirmDialog
        visible={deleting}
        title={t('account.deleteTitle')}
        message={deleteMessage}
        confirmLabel={t('cloud.deletePermanently')}
        destructive
        busy={cloud.deleting}
        onConfirm={() => {
          setTried(true);
          void cloud.deleteAccount().then((deleted) => deleted && closeDelete());
        }}
        onCancel={closeDelete}
      />
    </>
  );

  return { askSignOut: () => setSigningOut(true), askDelete: () => setDeleting(true), dialogs };
}

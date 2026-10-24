import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { useCloud } from '@/state/CloudProvider';
import { useTheme } from '@/theme';
import { OPEN_IN_STACK } from '@/components/navigation';

/** "Blocked users": opens the list with its "Unblock" buttons. Only for a signed-in account, the only one that can block. */
export function BlockedUsersRow() {
  const { t } = useTranslation('social');
  const router = useRouter();
  const theme = useTheme();
  const cloud = useCloud();
  if (!cloud.signedIn) return null;
  return (
    <NavRow
      icon="ban-outline"
      title={t('moderation.blocked.row')}
      subtitle={t('moderation.blocked.description')}
      onPress={() => router.push('/settings/blocked', OPEN_IN_STACK)}
      style={groupedRowStyle(theme, 0, 1)}
    />
  );
}

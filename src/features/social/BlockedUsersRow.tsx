import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { groupedRowStyle, NavRow } from '@/components/NavRow';
import { useCloud } from '@/state/CloudProvider';
import { useTheme } from '@/theme';

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
      onPress={() => router.push('/settings/blocked')}
      style={groupedRowStyle(theme, 0, 1)}
    />
  );
}

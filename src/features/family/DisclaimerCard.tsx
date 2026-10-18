import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { IconChip } from '@/components/IconChip';
import { Card } from '@/components/Screen';
import { spacing } from '@/theme';

/** The not-real-time, not-an-emergency-tool notice. It stays on every family screen: it is not something to dismiss. */
export function DisclaimerCard() {
  const { t } = useTranslation('family');
  return (
    <Card>
      <View style={styles.row}>
        <IconChip icon="information-circle" size="sm" />
        <AppText variant="caption" style={styles.text}>
          {t('disclaimer')}
        </AppText>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  text: { flex: 1 },
});

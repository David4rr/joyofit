import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { IconChip } from '@/components/IconChip';
import { Card, Screen } from '@/components/Screen';

import { SupportedWatches } from './SupportedWatches';
import { spacing } from '@/theme';

/**
 * Shown on the Watch tab to a phone that has never had a watch, before Bluetooth is asked for. A watch is optional: this says what it
 * adds and which ones work, and "Lanjut" goes on to the pairing screen.
 */
export function WatchIntro({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation(['nowatch', 'watch']);
  return (
    <Screen title={t('watch:title')}>
      <Card>
        <View style={styles.head}>
          <IconChip icon="watch" tint="link" size="lg" />
          <AppText variant="heading">{t('nowatch:intro.title')}</AppText>
        </View>
        <AppText variant="caption" muted>
          {t('nowatch:intro.body')}
        </AppText>
        <AppText variant="caption" muted>
          {t('nowatch:intro.permission')}
        </AppText>
        <Button label={t('nowatch:intro.continue')} variant="primary" icon="bluetooth" onPress={onContinue} />
      </Card>
      <SupportedWatches />
    </Screen>
  );
}

const styles = StyleSheet.create({
  head: { gap: spacing.sm },
});

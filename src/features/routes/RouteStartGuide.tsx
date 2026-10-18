import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Divider, Section } from '@/components/Screen';
import { spacing } from '@/theme';

import { NumberedSteps } from './NumberedSteps';

const STEP_KEYS = ['s1', 's2', 's3', 's4', 's5'] as const;
const LIMIT_KEYS = ['l1', 'l2', 'l3', 'l4'] as const;

/**
 * How to start a route on the watch, and what the watch will and will not do with it. Collapsed by default; it opens by
 * itself when a route has just been sent (`justSent`), which is when the person needs it.
 */
export function RouteStartGuide({ justSent }: { justSent: boolean }) {
  const { t } = useTranslation('routes');
  // Open by itself right after a send; once the person taps, their choice wins.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? justSent;

  return (
    <Section title={t('guide.title')} icon="help-circle" tint="link">
      {open ? (
        <View style={styles.body}>
          <AppText variant="body">{justSent ? t('guide.sentLead') : t('guide.intro')}</AppText>
          <NumberedSteps steps={STEP_KEYS.map((key) => t(`guide.steps.${key}`))} />
          <AppText variant="caption">{t('guide.during')}</AppText>
          <AppText variant="caption" muted>
            {t('guide.deleteOnWatch')}
          </AppText>
          <Divider />
          <AppText variant="bodyStrong">{t('guide.limitsTitle')}</AppText>
          {LIMIT_KEYS.map((key) => (
            <AppText key={key} variant="caption" muted>
              {`\u2022  ${t(`guide.limits.${key}`)}`}
            </AppText>
          ))}
        </View>
      ) : null}
      <Button
        label={open ? t('guide.hide') : t('guide.show')}
        icon={open ? 'chevron-up' : 'chevron-down'}
        onPress={() => setChosen(!open)}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  body: { gap: spacing.sm },
});

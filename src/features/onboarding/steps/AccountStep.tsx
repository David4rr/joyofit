import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Card } from '@/components/Screen';
import { Notice } from '@/components/States';
import { Bullet, StepIntro } from '@/features/onboarding/StepIntro';
import { SignInButtons } from '@/features/settings/SignInButtons';
import { useCloud } from '@/state/CloudProvider';
import { spacing } from '@/theme';

/** Optional JoyoRogo sign-in through the same provider and buttons Settings uses. */
export function AccountStep() {
  const { t } = useTranslation('onboarding');
  const cloud = useCloud();
  return (
    <>
      <StepIntro icon="restaurant" tint="steps" title={t('account.title')} badge={t('badge.optional')}>
        {t('account.intro')}
      </StepIntro>
      <Card>
        <AppText variant="heading">{t('account.givesTitle')}</AppText>
        <View style={styles.bullets}>
          <Bullet label={'\u2022'}>
            {t('account.gives1')}
          </Bullet>
          <Bullet label={'\u2022'}>{t('account.gives2')}</Bullet>
          <Bullet label={'\u2022'}>
            {t('account.gives3')}
          </Bullet>
        </View>
        <AppText variant="caption" muted>
          {t('account.note')}
        </AppText>
      </Card>
      {cloud.error ? <Notice tone="danger">{cloud.error}</Notice> : null}
      {cloud.signedIn ? (
        <Notice icon="checkmark-circle">{cloud.email ? t('account.signedInAs', { email: cloud.email }) : t('account.signedIn')}</Notice>
      ) : (
        <SignInButtons />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  bullets: { gap: spacing.sm },
});

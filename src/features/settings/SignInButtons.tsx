import { useTranslation } from 'react-i18next';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { isIos } from '@/components/IosUnavailable';
import { useCloud } from '@/state/CloudProvider';

/** The JoyoRogo sign-in buttons: Apple and Google where Sign in with Apple runs (iPhone), Google otherwise. Settings and the setup guide both use it. */
export function SignInButtons({ label, prompt }: { label?: string; prompt?: string } = {}) {
  const { t } = useTranslation('settings');
  const cloud = useCloud();

  if (isIos && cloud.appleAvailable) {
    return (
      <>
        <AppText variant="label" muted>
          {prompt ?? t('signIn.prompt')}
        </AppText>
        <ButtonRow>
          <Button
            label={t('signIn.apple')}
            variant="primary"
            icon="logo-apple"
            onPress={() => void cloud.signInApple()}
            disabled={cloud.sessionPending}
          />
          <Button
            label={t('signIn.google')}
            variant="secondary"
            icon="logo-google"
            onPress={() => void cloud.signIn()}
            disabled={cloud.sessionPending}
            loading={cloud.sessionPending}
          />
        </ButtonRow>
      </>
    );
  }

  return (
    <Button
      label={label ?? t('signIn.label')}
      variant="primary"
      icon="log-in-outline"
      onPress={() => void cloud.signIn()}
      disabled={cloud.sessionPending}
      loading={cloud.sessionPending}
    />
  );
}

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { isIos } from '@/components/IosUnavailable';
import { useCloud } from '@/state/CloudProvider';

/** The JoyoRogo sign-in buttons: Apple and Google where Sign in with Apple runs (iPhone), Google otherwise. Settings and the setup guide both use it. */
export function SignInButtons() {
  const cloud = useCloud();

  if (isIos && cloud.appleAvailable) {
    return (
      <>
        <AppText variant="label" muted>
          Sign in with
        </AppText>
        <ButtonRow>
          <Button
            label="Apple"
            variant="primary"
            icon="logo-apple"
            onPress={() => void cloud.signInApple()}
            disabled={cloud.sessionPending}
          />
          <Button
            label="Google"
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
      label="Sign in with JoyoRogo"
      variant="primary"
      icon="log-in-outline"
      onPress={() => void cloud.signIn()}
      disabled={cloud.sessionPending}
      loading={cloud.sessionPending}
    />
  );
}

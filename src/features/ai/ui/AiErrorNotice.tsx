import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Details } from '@/components/Details';
import { Notice } from '@/components/States';
import { spacing } from '@/theme';
import { PROVIDERS } from '../providers';
import type { ProviderId } from '../types';
import type { AiErrorView, ErrorTarget } from './errors';

/** Opens where an error's next step leads: the key setup, the model picker in settings, the settings, or the provider's key page. */
export function useErrorTarget(provider: ProviderId | null): (target: ErrorTarget) => void {
  const router = useRouter();
  return (target) => {
    if (target === 'setup') router.push('/settings/ai-setup');
    else if (target === 'model') router.push({ pathname: '/settings/ai', params: { model: '1' } });
    else if (target === 'settings') router.push('/settings/ai');
    else {
      const url = provider ? PROVIDERS[provider].keyUrl : null;
      if (url) void Linking.openURL(url).catch(() => {});
    }
  };
}

/** A failed provider call: the cause and the one next step as a danger notice, with the provider's own words collapsed under it. */
export function AiErrorNotice({ view, provider }: { view: AiErrorView; provider: ProviderId | null }) {
  const { t } = useTranslation('ai');
  const open = useErrorTarget(provider);
  const action = view.action;
  return (
    <View style={styles.wrap}>
      <Notice tone="danger" action={action ? { label: action.label, onPress: () => open(action.target) } : undefined}>
        {view.message}
      </Notice>
      {view.detail ? (
        <Details title={t('errors.detail')}>
          <AppText variant="caption" muted selectable>
            {view.detail}
          </AppText>
        </Details>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: spacing.xs } });

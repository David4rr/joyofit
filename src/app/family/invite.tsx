import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Share, StyleSheet, View } from 'react-native';

import { family, type FamilyInvite, type FamilyInviteRole } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ButtonRow } from '@/components/ButtonRow';
import { Chip } from '@/components/Chip';
import { Field } from '@/components/Input';
import { Screen, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { watchCapacity } from '@/features/family/capacity';
import { inviteShareMessage } from '@/features/family/copy';
import { DisclaimerCard } from '@/features/family/DisclaimerCard';
import { FamilyGate } from '@/features/family/FamilyGate';
import { useFamily } from '@/features/family/FamilyProvider';
import { clockLabel } from '@/features/family/format';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme';

const PRESETS = ['mom', 'dad'] as const;
const OTHER = 'other';
const PRESET_LABEL = { mom: 'family:invite.presetMom', dad: 'family:invite.presetDad' } as const;
const MAX_LABEL = 40;

/** Who the invite is for, and the code that goes with it. `role` (a route parameter) is the inviter's own side. */
export default function InviteScreen() {
  const { t } = useTranslation(['family', 'common']);
  const router = useRouter();
  const { role: param } = useLocalSearchParams<{ role?: string }>();
  const role: FamilyInviteRole = param === 'monitored' ? 'monitored' : 'watcher';
  const ctx = useFamily();
  const now = useNow(60_000);
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | typeof OTHER>('mom');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<FamilyInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const label = (preset === OTHER ? custom : t(PRESET_LABEL[preset])).trim();
  const capacity = role === 'watcher' ? watchCapacity(ctx.limits, ctx.watching.length) : 'ok';

  const create = async () => {
    if (capacity === 'pro') {
      ctx.showUpsell();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setInvite(await family.invites.create(role, label));
    } catch (e) {
      setError(ctx.fail(e));
    } finally {
      setBusy(false);
    }
  };

  const share = () => {
    if (invite) void Share.share({ message: inviteShareMessage(role, invite.url, invite.code) }).catch(() => {});
  };

  const copy = async () => {
    if (!invite) return;
    await Clipboard.setStringAsync(invite.code);
    setCopied(true);
  };

  return (
    <Screen>
      <FamilyGate>
        <DisclaimerCard />
        {invite ? (
          <Section title={t('family:invite.sectionCode')} icon="key" tint="link">
            <AppText variant="figure" selectable style={styles.code} accessibilityLabel={t('family:invite.codeA11y', { code: invite.code.split('').join(' ') })}>
              {invite.code}
            </AppText>
            <AppText variant="caption" muted>
              {t('family:invite.validUntil', { time: clockLabel(invite.expiresAt, now) })}
            </AppText>
            <ButtonRow>
              <Button label={t('common:actions.share')} icon="share-outline" variant="primary" onPress={share} />
              <Button label={copied ? t('family:invite.copied') : t('family:invite.copyCode')} icon={copied ? 'checkmark' : 'copy-outline'} onPress={() => void copy()} />
            </ButtonRow>
            <Button label={t('common:actions.done')} variant="ghost" onPress={() => router.back()} />
          </Section>
        ) : (
          <Section title={role === 'watcher' ? t('family:invite.titleWatcher') : t('family:invite.titleMonitored')} icon="person-add" tint="link">
            <AppText variant="caption" muted>
              {role === 'watcher'
                ? t('family:invite.introWatcher')
                : t('family:invite.introMonitored')}
            </AppText>
            <AppText variant="label" muted>
              {role === 'watcher' ? t('family:invite.askWatcher') : t('family:invite.askMonitored')}
            </AppText>
            <View style={styles.chips}>
              {PRESETS.map((name) => (
                <Chip key={name} label={t(PRESET_LABEL[name])} selected={preset === name} onPress={() => setPreset(name)} role="radio" />
              ))}
              <Chip label={t('family:invite.presetOther')} selected={preset === OTHER} onPress={() => setPreset(OTHER)} role="radio" />
            </View>
            {preset === OTHER ? (
              <Field label={t('family:invite.nickname')} value={custom} onChangeText={setCustom} maxLength={MAX_LABEL} autoCapitalize="words" autoCorrect={false} />
            ) : null}
            {capacity === 'full' ? <Notice>{t('family:invite.full')}</Notice> : null}
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button
              label={t('family:invite.create')}
              variant="primary"
              icon="key"
              disabled={label.length === 0 || capacity === 'full'}
              loading={busy}
              onPress={() => void create()}
            />
          </Section>
        )}
      </FamilyGate>
    </Screen>
  );
}

const styles = StyleSheet.create({
  code: { textAlign: 'center', letterSpacing: 4, paddingVertical: spacing.sm },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

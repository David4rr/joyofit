import * as Clipboard from 'expo-clipboard';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
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

const PRESETS = ['Ibu', 'Bapak'] as const;
const OTHER = 'lainnya';
const MAX_LABEL = 40;

/** Who the invite is for, and the code that goes with it. `role` (a route parameter) is the inviter's own side. */
export default function InviteScreen() {
  const router = useRouter();
  const { role: param } = useLocalSearchParams<{ role?: string }>();
  const role: FamilyInviteRole = param === 'monitored' ? 'monitored' : 'watcher';
  const ctx = useFamily();
  const now = useNow(60_000);
  const [preset, setPreset] = useState<(typeof PRESETS)[number] | typeof OTHER>('Ibu');
  const [custom, setCustom] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<FamilyInvite | null>(null);
  const [copied, setCopied] = useState(false);

  const label = (preset === OTHER ? custom : preset).trim();
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
          <Section title="Kode undangan" icon="key" tint="link">
            <AppText variant="figure" selectable style={styles.code} accessibilityLabel={`Kode ${invite.code.split('').join(' ')}`}>
              {invite.code}
            </AppText>
            <AppText variant="caption" muted>
              Berlaku sampai {clockLabel(invite.expiresAt, now)}, dan hanya bisa dipakai sekali.
            </AppText>
            <ButtonRow>
              <Button label="Bagikan" icon="share-outline" variant="primary" onPress={share} />
              <Button label={copied ? 'Tersalin' : 'Salin kode'} icon={copied ? 'checkmark' : 'copy-outline'} onPress={() => void copy()} />
            </ButtonRow>
            <Button label="Selesai" variant="ghost" onPress={() => router.back()} />
          </Section>
        ) : (
          <Section title={role === 'watcher' ? 'Undang orang tua' : 'Undang pemantau'} icon="person-add" tint="link">
            <AppText variant="caption" muted>
              {role === 'watcher'
                ? 'Kamu akan mendapat kode untuk dikirim ke orang tuamu. Mereka melihat siapa yang meminta, lalu memilih sendiri apa yang dibagikan.'
                : 'Kamu akan mendapat kode untuk dikirim ke orang yang boleh melihat kabarmu. Kamu tetap yang memilih apa yang dibagikan.'}
            </AppText>
            <AppText variant="label" muted>
              {role === 'watcher' ? 'Orang tua ini kamu panggil apa?' : 'Pemantau akan memanggilmu apa?'}
            </AppText>
            <View style={styles.chips}>
              {PRESETS.map((name) => (
                <Chip key={name} label={name} selected={preset === name} onPress={() => setPreset(name)} role="radio" />
              ))}
              <Chip label="Lainnya" selected={preset === OTHER} onPress={() => setPreset(OTHER)} role="radio" />
            </View>
            {preset === OTHER ? (
              <Field label="Nama panggilan" value={custom} onChangeText={setCustom} maxLength={MAX_LABEL} autoCapitalize="words" autoCorrect={false} />
            ) : null}
            {capacity === 'full' ? <Notice>Kamu sudah memantau jumlah orang maksimal. Hapus salah satu dulu.</Notice> : null}
            {error ? <Notice tone="danger">{error}</Notice> : null}
            <Button
              label="Buat kode undangan"
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

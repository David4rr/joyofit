import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';

import { family, type FamilyInvitePreview } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { Screen, Section } from '@/components/Screen';
import { LoadingState, Notice } from '@/components/States';
import { watchCapacity } from '@/features/family/capacity';
import { DisclaimerCard } from '@/features/family/DisclaimerCard';
import { FamilyGate } from '@/features/family/FamilyGate';
import { useFamily } from '@/features/family/FamilyProvider';
import { clockLabel } from '@/features/family/format';
import { useNow } from '@/hooks/useNow';
import { INVITE_CODE_LENGTH, normalizeInviteCode, previewLine } from '@/features/family/invite';

/**
 * Where `joyofit://family/accept?code=` lands, and the manual entry of a code. It shows who is asking, then accepts: the
 * monitored person goes on to the consent screen (nothing uploads before it), a watcher to the dashboard to wait for it.
 */
export default function AcceptScreen() {
  const router = useRouter();
  const { code: param } = useLocalSearchParams<{ code?: string }>();
  const ctx = useFamily();
  const now = useNow(60_000);
  const [code, setCode] = useState(() => normalizeInviteCode(param ?? ''));
  const [preview, setPreview] = useState<FamilyInvitePreview | null>(null);
  const [checking, setChecking] = useState(false);
  const [labelEdit, setLabelEdit] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // A deep link can arrive while this screen is open: the parameter is an external input the field mirrors.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (param) setCode(normalizeInviteCode(param));
  }, [param]);

  useEffect(() => {
    // A new code starts from a clean slate before its preview is fetched.
    /* eslint-disable react-hooks/set-state-in-effect */
    setPreview(null);
    setLabelEdit(null);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    if (code.length !== INVITE_CODE_LENGTH || !ctx.available) return;
    let live = true;
     
    setChecking(true);
    family.invites.preview(code).then(
      (answer) => {
        if (!live) return;
        setPreview(answer);
        setChecking(false);
      },
      (e) => {
        if (!live) return;
        setError(ctx.fail(e));
        setChecking(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `ctx.fail` never changes what the call does; the code and the session are the triggers
  }, [code, ctx.available]);

  // Accepting a monitored person's invite makes the acceptor the watcher, who calls them something and counts against the limit.
  const watches = preview?.inviterRole === 'monitored';
  const label = labelEdit ?? preview?.label ?? '';
  const capacity = watches ? watchCapacity(ctx.limits, ctx.watching.length) : 'ok';

  const accept = async () => {
    if (!preview) return;
    if (capacity === 'pro') {
      ctx.showUpsell();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { link } = await family.invites.accept(code, watches ? label.trim() : undefined);
      await ctx.refresh();
      if (link.role === 'watchedBy') router.replace({ pathname: '/family/consent/[id]', params: { id: link.id } });
      else router.replace('/family');
    } catch (e) {
      setError(ctx.fail(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <FamilyGate>
        <DisclaimerCard />
        <Section title="Kode undangan" icon="key" tint="link">
          <Field
            label="Kode 8 karakter"
            value={code}
            onChangeText={(text) => setCode(normalizeInviteCode(text))}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={INVITE_CODE_LENGTH + 4}
          />
          {checking ? <LoadingState label="Memeriksa kode" /> : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
        </Section>
        {preview ? (
          <Section title="Undangan" icon="mail-open" tint="link">
            <AppText variant="bodyStrong">{previewLine(preview)}</AppText>
            <AppText variant="caption" muted>
              Berlaku sampai {clockLabel(preview.expiresAt, now)}.
            </AppText>
            {watches ? (
              <>
                <Field label="Kamu memanggilnya apa?" value={label} onChangeText={setLabelEdit} maxLength={40} autoCapitalize="words" autoCorrect={false} />
                {capacity === 'full' ? <Notice>Kamu sudah memantau jumlah orang maksimal. Hapus salah satu dulu.</Notice> : null}
              </>
            ) : (
              <AppText variant="caption" muted>
                Belum ada yang dibagikan. Di layar berikutnya kamu yang memilih apa yang boleh dilihat.
              </AppText>
            )}
            <Button
              label="Lanjut"
              variant="primary"
              disabled={capacity === 'full' || (watches && label.trim().length === 0)}
              loading={busy}
              onPress={() => void accept()}
            />
          </Section>
        ) : null}
      </FamilyGate>
    </Screen>
  );
}

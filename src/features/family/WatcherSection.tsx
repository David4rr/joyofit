import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { family, type FamilyLink, type FamilyScopes } from '@/cloud/family';
import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Chip } from '@/components/Chip';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Divider, Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { SwitchRow } from '@/components/SwitchRow';
import { scopeRows } from '@/features/family/copy';
import { useFamily } from '@/features/family/FamilyProvider';
import { lastViewedText, pauseText, pauseUntil, type PauseChoice } from '@/features/family/format';
import { useNow } from '@/hooks/useNow';
import { spacing } from '@/theme';

const PAUSES = ['hour', 'today', 'manual'] as const satisfies readonly PauseChoice[];
const PAUSE_LABEL = { hour: 'watcher.pauseHour', today: 'watcher.pauseToday', manual: 'watcher.pauseManual' } as const;

/** One person who watches you: what they see, a pause, and the way to cut them off. Each change goes to the Worker at once. */
export function WatcherSection({ link }: { link: FamilyLink }) {
  const { t } = useTranslation(['family', 'common']);
  const router = useRouter();
  const ctx = useFamily();
  const nowMs = useNow(60_000);
  const [scopes, setScopes] = useState<FamilyScopes | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  /** Runs one change, then reads the links again: the uploader follows them and sends or stops accordingly. */
  const change = async (run: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await run();
      await ctx.refresh();
    } catch (e) {
      setError(ctx.fail(e));
    } finally {
      setScopes(null);
      setBusy(false);
    }
  };

  const toggle = (key: keyof FamilyScopes, on: boolean) => {
    const next = { ...(scopes ?? link.scopes), [key]: on };
    setScopes(next);
    void change(() => family.links.update(link.id, { scopes: next }));
  };

  if (link.status === 'pending') {
    return (
      <Section title={link.otherName} icon="person" tint="link">
        <AppText variant="caption" muted>
          {t('family:watcher.pending', { name: link.otherName })}
        </AppText>
        <Button
          label={t('family:watcher.review')}
          variant="primary"
          onPress={() => router.push({ pathname: '/family/consent/[id]', params: { id: link.id } })}
        />
      </Section>
    );
  }

  const shown = scopes ?? link.scopes;
  const paused = pauseText(link.pausedUntil, nowMs);

  return (
    <Section title={link.otherName} icon="person" tint="link">
      <AppText variant="caption" muted>
        {lastViewedText(link.lastViewedAt, nowMs)}
      </AppText>
      {paused ? (
        <Notice icon="pause-circle">{paused}</Notice>
      ) : null}
      {scopeRows().map((row) => (
        <SwitchRow
          key={row.key}
          label={row.label}
          hint={row.hint}
          value={shown[row.key]}
          disabled={row.key === 'sync' || busy}
          onValueChange={(on) => toggle(row.key, on)}
        />
      ))}
      <Divider />
      {paused ? (
        <Button label={t('family:watcher.resume')} icon="play" disabled={busy} onPress={() => void change(() => family.links.update(link.id, { pausedUntil: null }))} />
      ) : (
        <>
          <AppText variant="label" muted>
            {t('family:watcher.pause')}
          </AppText>
          <View style={styles.chips}>
            {PAUSES.map((choice) => (
              <Chip
                key={choice}
                label={t(`family:${PAUSE_LABEL[choice]}`)}
                selected={false}
                onPress={() => void change(() => family.links.update(link.id, { pausedUntil: pauseUntil(choice, Date.now()) }))}
              />
            ))}
          </View>
        </>
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Button label={t('family:watcher.remove')} variant="destructive" icon="trash" disabled={busy} onPress={() => setRemoving(true)} />
      <ConfirmDialog
        visible={removing}
        title={t('family:watcher.removeTitle', { name: link.otherName })}
        message={t('family:watcher.removeMessage', { name: link.otherName })}
        confirmLabel={t('family:watcher.removeConfirm')}
        cancelLabel={t('common:actions.cancel')}
        onConfirm={() => {
          setRemoving(false);
          void change(() => family.links.remove(link.id));
        }}
        onCancel={() => setRemoving(false)}
      />
    </Section>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

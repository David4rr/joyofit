import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { spacing, useTheme } from '@/theme';

import type { PushOutcome } from './pushOutcome';
import type { PushPhase, RoutePush } from './useRoutePush';
import { alternativeName } from './watchRoute';

type Push = RoutePush;

/** A determinate bar: 0 while preparing, the share of bytes acknowledged while sending, full while waiting for the watch. */
function ProgressBar({ phase, percent }: { phase: Exclude<PushPhase, 'idle'>; percent: number }) {
  const { t } = useTranslation('routes');
  const { colors } = useTheme();
  const shown = phase === 'waiting' ? 100 : phase === 'preparing' ? 0 : percent;
  const label = phase === 'sending' ? t('push.sendingPercent', { pct: shown }) : t(`push.${phase}`);
  return (
    <View style={styles.progress} accessible accessibilityRole="progressbar" accessibilityLabel={t('push.progressLabel')} accessibilityValue={{ min: 0, max: 100, now: shown, text: label }}>
      <View style={[styles.track, { backgroundColor: colors.muted }]}>
        <View style={[styles.fill, { width: `${shown}%`, backgroundColor: colors.primary }]} />
      </View>
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

/** The watch already has a route of this name, or refuses the name: pick another one and send again. */
function RenameAndSend({ name, disabled, onSend }: { name: string; disabled: boolean; onSend: (name: string) => void }) {
  const { t } = useTranslation('routes');
  const [value, setValue] = useState(() => alternativeName(name));
  const trimmed = value.trim();
  const empty = trimmed === '';
  return (
    <View style={styles.rename}>
      <Field
        label={t('push.renameLabel')}
        value={value}
        onChangeText={setValue}
        icon="pricetag"
        autoCapitalize="sentences"
        hint={empty ? t('push.renameEmpty') : undefined}
        maxLength={100}
      />
      <Button label={t('push.renameAndSend')} icon="send" variant="primary" disabled={disabled || empty} onPress={() => onSend(trimmed)} />
    </View>
  );
}

function OutcomeView({ outcome, push, routeName }: { outcome: PushOutcome; push: Push; routeName: string }) {
  const { t } = useTranslation('routes');
  if (outcome.kind === 'sent') {
    return (
      <View style={styles.outcome}>
        <Notice icon="checkmark-circle">{t('push.sent')}</Notice>
        <AppText variant="caption" muted>
          {outcome.sentPoints < outcome.totalPoints
            ? t('push.sentPointsPartial', { sent: outcome.sentPoints, total: outcome.totalPoints })
            : t('push.sentPointsAll', { count: outcome.sentPoints })}
        </AppText>
        {!outcome.confirmed ? <Notice>{t('push.noFinalAnswer')}</Notice> : null}
        {push.recordError !== null ? <Notice tone="danger">{push.recordError}</Notice> : null}
      </View>
    );
  }
  if (outcome.kind === 'already') {
    return (
      <View style={styles.outcome}>
        <Notice icon="alert-circle">{t('push.already')}</Notice>
        <AppText variant="caption" muted>
          {t('push.alreadyHint')}
        </AppText>
        <RenameAndSend name={routeName} disabled={push.sending} onSend={(name) => void push.send(name)} />
      </View>
    );
  }
  return (
    <View style={styles.outcome}>
      <Notice tone="danger">{outcome.message}</Notice>
      {outcome.canRename ? <RenameAndSend name={routeName} disabled={push.sending} onSend={(name) => void push.send(name)} /> : null}
    </View>
  );
}

/** "Kirim ke jam" / "Send to watch": the send button, its progress and what came of it. `push` is `useRoutePush`'s result for the open route. */
export function RoutePushSection({ push, routeName }: { push: Push; routeName: string }) {
  const { t } = useTranslation('routes');
  const router = useRouter();
  const { connected, status, appOutdated, phase, percent, outcome, sending } = push;
  const unsupported = connected && !status.deliver;
  return (
    <Section title={t('push.title')} icon="send" tint="link">
      <AppText variant="caption" muted>
        {t('push.explainer')}
      </AppText>
      {!connected ? (
        <Notice icon="bluetooth" action={{ label: t('push.openWatch'), onPress: () => router.navigate('/watch') }}>
          {t('push.needConnect')}
        </Notice>
      ) : null}
      {unsupported && !appOutdated ? <Notice>{t('push.unsupported')}</Notice> : null}
      {appOutdated ? <Notice tone="danger">{t('push.appOutdated')}</Notice> : null}
      <Button
        label={t('push.send')}
        icon="send"
        variant="primary"
        loading={sending}
        disabled={!connected || unsupported || appOutdated}
        onPress={() => void push.send()}
      />
      {phase !== 'idle' ? <ProgressBar phase={phase} percent={percent} /> : null}
      {outcome !== null && !sending ? <OutcomeView outcome={outcome} push={push} routeName={routeName} /> : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  progress: { gap: spacing.xs },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: 8, borderRadius: 4 },
  outcome: { gap: spacing.sm },
  rename: { gap: spacing.sm },
});

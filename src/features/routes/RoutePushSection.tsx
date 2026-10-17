import { useRouter } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { Field } from '@/components/Input';
import { Section } from '@/components/Screen';
import { Notice } from '@/components/States';
import { spacing, useTheme } from '@/theme';

import { copy } from './copy';
import type { PushOutcome } from './pushOutcome';
import type { PushPhase, RoutePush } from './useRoutePush';
import { alternativeName } from './watchRoute';

type Push = RoutePush;

const PHASE_LABEL: Record<Exclude<PushPhase, 'idle'>, string> = {
  preparing: copy.push.preparing,
  sending: copy.push.sending,
  waiting: copy.push.waiting,
};

/** A determinate bar: 0 while preparing, the share of bytes acknowledged while sending, full while waiting for the watch. */
function ProgressBar({ phase, percent }: { phase: Exclude<PushPhase, 'idle'>; percent: number }) {
  const { colors } = useTheme();
  const shown = phase === 'waiting' ? 100 : phase === 'preparing' ? 0 : percent;
  const label = phase === 'sending' ? copy.push.sendingPercent(shown) : PHASE_LABEL[phase];
  return (
    <View style={styles.progress} accessible accessibilityRole="progressbar" accessibilityLabel={copy.push.progressLabel} accessibilityValue={{ min: 0, max: 100, now: shown, text: label }}>
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
  const [value, setValue] = useState(() => alternativeName(name));
  const trimmed = value.trim();
  const empty = trimmed === '';
  return (
    <View style={styles.rename}>
      <Field
        label={copy.push.renameLabel}
        value={value}
        onChangeText={setValue}
        icon="pricetag"
        autoCapitalize="sentences"
        hint={empty ? copy.push.renameEmpty : undefined}
        maxLength={100}
      />
      <Button label={copy.push.renameAndSend} icon="send" variant="primary" disabled={disabled || empty} onPress={() => onSend(trimmed)} />
    </View>
  );
}

function OutcomeView({ outcome, push, routeName }: { outcome: PushOutcome; push: Push; routeName: string }) {
  if (outcome.kind === 'sent') {
    return (
      <View style={styles.outcome}>
        <Notice icon="checkmark-circle">{copy.push.sent}</Notice>
        <AppText variant="caption" muted>
          {copy.push.sentPoints(outcome.sentPoints, outcome.totalPoints)}
        </AppText>
        {!outcome.confirmed ? <Notice>{copy.push.noFinalAnswer}</Notice> : null}
        {push.recordError !== null ? <Notice tone="danger">{push.recordError}</Notice> : null}
      </View>
    );
  }
  if (outcome.kind === 'already') {
    return (
      <View style={styles.outcome}>
        <Notice icon="alert-circle">{copy.push.already}</Notice>
        <AppText variant="caption" muted>
          {copy.push.alreadyHint}
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

/** "Kirim ke jam": the send button, its progress and what came of it. `push` is `useRoutePush`'s result for the open route. */
export function RoutePushSection({ push, routeName }: { push: Push; routeName: string }) {
  const router = useRouter();
  const { connected, status, appOutdated, phase, percent, outcome, sending } = push;
  const unsupported = connected && !status.deliver;
  return (
    <Section title={copy.push.title} icon="send" tint="link">
      <AppText variant="caption" muted>
        {copy.push.explainer}
      </AppText>
      {!connected ? (
        <Notice icon="bluetooth" action={{ label: copy.push.openWatch, onPress: () => router.navigate('/watch') }}>
          {copy.push.needConnect}
        </Notice>
      ) : null}
      {unsupported && !appOutdated ? <Notice>{copy.push.unsupported}</Notice> : null}
      {appOutdated ? <Notice tone="danger">{copy.push.appOutdated}</Notice> : null}
      <Button
        label={copy.push.send}
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

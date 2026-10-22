import { useRouter } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View, type ScrollView } from 'react-native';

import { AppText } from '@/components/AppText';
import { Button } from '@/components/Button';
import { ChipRow } from '@/components/ChipRow';
import { Details } from '@/components/Details';
import { Input } from '@/components/Input';
import { Card, Screen } from '@/components/Screen';
import { Notice, Skeleton } from '@/components/States';
import { useToast } from '@/components/Toast';
import { chatFailure, coachChat, MAX_MESSAGE_CHARS } from '@/features/coach/chat/api';
import { chatLines, clearChat, readChat, writeChat, type StoredTurn } from '@/features/coach/chat/history';
import { buildSnapshot } from '@/features/coach/chat/snapshot';
import { CoachSignIn } from '@/features/coach/ui/CoachGate';
import { useCoach } from '@/features/coach/useCoach';
import { useCoachAccess } from '@/features/coach/useCoachAccess';
import { UpgradeCard } from '@/features/pro/UpgradeCard';
import { useNightHrvAvailability } from '@/features/today/useNightHrvAvailability';
import { fmtInt, useLocale } from '@/i18n';
import { useCloud } from '@/state/CloudProvider';
import { useWatch } from '@/state/WatchProvider';
import { spacing, useColors, useTheme } from '@/theme';
import { askJoyoAi } from '../engine';
import { hostOf } from '../providers';
import { useByokAccess } from '../hooks';
import type { SafetyText } from '../safety';
import { aiUsage } from '../stores';
import { AiError } from '../types';
import { AiBasis } from './AiBasis';
import { AiErrorNotice } from './AiErrorNotice';
import { workingText } from './basis';
import { EngineChip } from './EngineChip';
import { GateCard } from './GateCard';
import { viewAiError, type AiErrorView } from './errors';
import { ProposedNotes } from './ProposedNotes';
import { ownChipLabel } from './status';
import { useRogoStatus } from './useRogoStatus';

const SUGGESTIONS = ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'] as const;

function Bubble({ turn }: { turn: StoredTurn }) {
  const { colors, radius } = useTheme();
  const mine = turn.role === 'user';
  return (
    <View style={[styles.bubble, { backgroundColor: mine ? colors.primary : colors.muted, borderRadius: radius.card }]}>
      <AppText variant="body" color={mine ? colors.primaryForeground : undefined} selectable>
        {turn.content}
      </AppText>
    </View>
  );
}

/** Joyo AI: the chat. Answers come from the person's own key (on the phone) or from JoyoRogo's hosted coach (Pro), whichever Settings, Joyo AI says. */
export function JoyoAiChat() {
  const { t } = useTranslation('ai');
  const { t: tc } = useTranslation('coach');
  useLocale();
  const colors = useColors();
  const router = useRouter();
  const db = useSQLiteContext();
  const cloud = useCloud();
  const { dataVersion } = useWatch();
  const availability = useNightHrvAvailability(dataVersion);
  const coach = useCoach(dataVersion, availability);
  const coachAccess = useCoachAccess();
  const { access, settings } = useByokAccess();
  const { toast, show } = useToast();
  const scrollRef = useRef<ScrollView>(null);

  const [turns, setTurns] = useState<StoredTurn[]>(readChat);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [aiError, setAiError] = useState<AiErrorView | null>(null);
  const [hostedError, setHostedError] = useState<string | null>(null);
  // The server refused the hosted chat because the account is not Pro (the phone's last known answer said it was).
  const [paywall, setPaywall] = useState(false);
  const [flagged, setFlagged] = useState(false);
  const [toolsOff, setToolsOff] = useState(false);
  const [usage, setUsage] = useState(() => aiUsage.today(Math.floor(Date.now() / 1000)));

  const engine = settings.engine;
  const [rogoUsage, setRogoUsage] = useRogoStatus(engine === 'rogo' && coachAccess === 'pro');

  const mounted = useRef(true);
  const controller = useRef<AbortController | null>(null);
  // Why the request was aborted: "user" puts the question back in the box; a cleared chat or a closed screen ends quietly.
  const stopped = useRef<'user' | 'clear' | null>(null);
  // A cleared conversation must not receive the answer of a request that was still running.
  const generation = useRef(0);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      stopped.current = 'clear';
      controller.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (turns.length === 0 && !sending) return;
    const id = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(id);
  }, [turns.length, sending, aiError, hostedError]);

  const gate: 'checking' | 'rogoSignIn' | 'rogoUpsell' | 'blocked' | 'ready' =
    engine === 'rogo'
      ? coachAccess === 'checking'
        ? 'checking'
        : coachAccess === 'signedOut'
          ? 'rogoSignIn'
          : coachAccess === 'free'
            ? 'rogoUpsell'
            : 'ready'
      : access === null
        ? 'checking'
        : access.ok
          ? 'ready'
          : 'blocked';
  const own = engine === 'byok' && access?.ok ? access : null;

  const safetyText: SafetyText = {
    disclaimer: t('disclaimerLine'),
    refuseLeak: t('refuseLeak'),
    safe: { injury: t('safe.injury'), medical: t('safe.medical'), eatingDisorder: t('safe.eatingDisorder'), minorDiet: t('safe.minorDiet') },
  };

  const send = async (content: string) => {
    const message = content.trim();
    if (!message || sending || !coach || gate !== 'ready') return;
    const before = turns;
    const next: StoredTurn[] = [...before, { role: 'user', content: message.slice(0, MAX_MESSAGE_CHARS) }];
    const mine = generation.current;
    setTurns(next);
    setText('');
    setSending(true);
    setStatus(null);
    setAiError(null);
    setHostedError(null);
    setPaywall(false);
    setFlagged(false);
    setToolsOff(false);
    stopped.current = null;
    try {
      let reply: StoredTurn;
      if (own) {
        const ctl = new AbortController();
        controller.current = ctl;
        const answer = await askJoyoAi({
          db,
          coach,
          signedIn: cloud.signedIn,
          history: chatLines(next),
          text: safetyText,
          signal: ctl.signal,
          onStatus: (s) => {
            if (mounted.current && generation.current === mine) setStatus(workingText(s, t));
          },
        });
        if (!mounted.current || generation.current !== mine) return;
        reply = {
          role: 'assistant',
          content: answer.reply,
          ...(answer.fixed ? {} : { trace: answer.trace, provider: own.provider, model: own.model }),
          ...(answer.proposedNotes.length > 0 ? { proposed: answer.proposedNotes } : {}),
        };
        setFlagged(answer.fixed);
        setToolsOff(answer.toolsUnsupported);
      } else {
        const answer = await coachChat(chatLines(next), buildSnapshot(coach));
        if (!mounted.current || generation.current !== mine) return;
        reply = { role: 'assistant', content: answer.reply };
        setRogoUsage({ used: answer.used, cap: answer.cap });
        setFlagged(answer.flagged !== null);
      }
      const done = [...next, reply];
      setTurns(done);
      writeChat(done);
    } catch (e) {
      if (!mounted.current || generation.current !== mine) return;
      if (e instanceof AiError && e.kind === 'aborted') {
        if (stopped.current !== 'user') return;
      } else if (own) {
        setAiError(viewAiError(e, t, { provider: own.provider, ceiling: settings.dailyCeiling }));
      } else {
        const failure = chatFailure(e);
        setPaywall(failure.kind === 'paywall');
        setHostedError(failure.kind === 'cap' ? tc('chat.capReached') : failure.kind === 'other' ? tc('chat.error', { message: failure.message }) : null);
      }
      // Keep the question in the box so it can be sent again.
      setTurns(before);
      setText(message);
    } finally {
      controller.current = null;
      if (mounted.current && generation.current === mine) {
        setSending(false);
        setStatus(null);
        setUsage(aiUsage.today(Math.floor(Date.now() / 1000)));
      }
    }
  };

  const cancel = () => {
    stopped.current = 'user';
    controller.current?.abort();
  };

  const clear = () => {
    generation.current += 1;
    stopped.current = 'clear';
    controller.current?.abort();
    clearChat();
    setTurns([]);
    setSending(false);
    setStatus(null);
    setAiError(null);
    setHostedError(null);
    setPaywall(false);
    setFlagged(false);
    setToolsOff(false);
  };

  const resolveNote = (index: number, note: string, saved: boolean) => {
    const next = turns.map((turn, i) => {
      if (i !== index) return turn;
      const rest = (turn.proposed ?? []).filter((n) => n !== note);
      return { ...turn, proposed: rest.length > 0 ? rest : undefined };
    });
    setTurns(next);
    writeChat(next);
    if (saved) show(t('notes.saved'));
  };

  const chipLabel = own
    ? ownChipLabel(own, t)
    : engine === 'rogo'
      ? rogoUsage
        ? t('chip.rogoUsed', { used: fmtInt(rogoUsage.used), cap: fmtInt(rogoUsage.cap) })
        : t('chip.rogo')
      : t('chip.ownOff');

  const providerName = own ? t(`provider.${own.provider}`) : '';
  const composer =
    gate === 'ready' && coach ? (
      <View style={styles.footer}>
        {text.length === 0 && !sending ? (
          <ChipRow
            items={SUGGESTIONS.map((key) => ({ key, label: tc(`chat.suggest.${key}`), selected: false, onPress: () => void send(tc(`chat.suggest.${key}`)) }))}
            fadeColor={colors.background}
          />
        ) : null}
        <View style={styles.inputRow}>
          <View style={styles.grow}>
            <Input
              value={text}
              onChangeText={setText}
              placeholder={tc('chat.placeholder')}
              multiline
              maxLength={MAX_MESSAGE_CHARS}
              editable={!sending}
              accessibilityLabel={tc('chat.placeholder')}
              style={styles.field}
            />
          </View>
          <Button label={tc('chat.send')} variant="primary" icon="send" iconOnly onPress={() => void send(text)} disabled={text.trim().length === 0} loading={sending} />
        </View>
        <AppText variant="caption" muted style={styles.standing}>
          {t('standing')}
        </AppText>
      </View>
    ) : undefined;

  return (
    <View style={styles.root}>
      <Screen scrollRef={scrollRef} footer={composer}>
        <View style={styles.head}>
          <EngineChip label={chipLabel} />
          {own ? (
            <AppText variant="caption" muted>
              {t('chat.usageToday', { tokens: fmtInt(usage.inputTokens + usage.outputTokens), calls: fmtInt(usage.calls), ceiling: fmtInt(settings.dailyCeiling) })}
            </AppText>
          ) : null}
        </View>

        {gate === 'checking' ? <Skeleton width="100%" height={140} radius="card" /> : null}
        {gate === 'rogoSignIn' || gate === 'rogoUpsell' ? (
          <>
            {gate === 'rogoSignIn' ? <CoachSignIn /> : <UpgradeCard moment="coach-chat" />}
            <Card>
              <AppText variant="heading">{t('chat.ownTitle')}</AppText>
              <AppText variant="caption" muted>
                {t('chat.ownBody')}
              </AppText>
              <Button label={t('chat.ownCta')} variant="secondary" icon="key" onPress={() => router.push('/settings/ai-setup')} />
            </Card>
          </>
        ) : null}
        {gate === 'blocked' && access && !access.ok ? <GateCard reason={access.reason} provider={settings.provider} /> : null}

        {gate === 'ready' && !coach ? <Skeleton width="100%" height={220} radius="card" /> : null}
        {gate === 'ready' && coach ? (
          <>
            {own && !cloud.signedIn ? (
              <Notice icon="restaurant" action={{ label: t('chat.signIn'), onPress: () => router.push('/settings/akun') }}>
                {t('chat.noFood')}
              </Notice>
            ) : null}

            {turns.length === 0 ? (
              <Card>
                <AppText variant="heading">{tc('chat.emptyTitle')}</AppText>
                <AppText variant="caption" muted>
                  {own ? t('chat.emptyOwn', { model: own.model, provider: providerName }) : tc('chat.emptyBody')}
                </AppText>
              </Card>
            ) : (
              <View style={styles.list}>
                {turns.map((turn, index) => (
                  <View key={index} style={[styles.item, turn.role === 'user' ? styles.itemMine : styles.itemCoach]}>
                    <Bubble turn={turn} />
                    {turn.role === 'assistant' && turn.trace ? (
                      <AiBasis trace={turn.trace} provider={turn.provider ? t(`provider.${turn.provider}`) : null} model={turn.model ?? null} />
                    ) : null}
                    {turn.proposed ? (
                      <ProposedNotes
                        notes={turn.proposed}
                        disabled={sending}
                        onSaved={(note) => resolveNote(index, note, true)}
                        onDismiss={(note) => resolveNote(index, note, false)}
                      />
                    ) : null}
                  </View>
                ))}
              </View>
            )}

            {sending ? (
              <View style={styles.working}>
                <AppText variant="caption" muted style={styles.grow}>
                  {own ? (status ?? t('working.thinking')) : tc('chat.thinking')}
                </AppText>
                {own ? <Button label={t('chat.cancel')} variant="ghost" onPress={cancel} /> : null}
              </View>
            ) : null}
            {flagged ? <Notice icon="medkit">{tc('chat.flagged')}</Notice> : null}
            {toolsOff ? (
              <Notice icon="construct" action={{ label: t('errors.action.model'), onPress: () => router.push({ pathname: '/settings/ai', params: { model: '1' } }) }}>
                {t('chat.toolsOff')}
              </Notice>
            ) : null}
            {paywall ? <UpgradeCard moment="coach-chat" /> : null}
            {hostedError ? <Notice tone="danger">{hostedError}</Notice> : null}
            {aiError ? <AiErrorNotice view={aiError} provider={own?.provider ?? null} /> : null}
            {turns.length > 0 ? <Button label={tc('chat.clear')} variant="ghost" icon="trash" onPress={clear} /> : null}
            <Details>
              <AppText variant="caption" muted>
                {own ? t('chat.privacyOwn', { provider: providerName, host: hostOf(own.baseUrl) }) : tc('chat.privacy')}
              </AppText>
              <AppText variant="caption" muted>
                {t('chat.disclaimer')}
              </AppText>
            </Details>
          </>
        ) : null}
      </Screen>
      {toast}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  head: { gap: spacing.xs },
  list: { gap: spacing.md },
  item: { gap: spacing.xs },
  itemMine: { alignItems: 'flex-end' },
  itemCoach: { alignItems: 'flex-start' },
  bubble: { maxWidth: '85%', paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  working: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.sm, gap: spacing.sm },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.sm },
  grow: { flex: 1 },
  field: { maxHeight: 120 },
  standing: { textAlign: 'center' },
});

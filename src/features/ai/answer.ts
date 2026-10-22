import { ADAPTERS } from './adapters';
import { byokAccess, type ByokBlock } from './access';
import { buildDigest, digestJson, type Digest, type DigestSource } from './digest';
import type { Person } from './person';
import { PROVIDERS } from './providers';
import { assessMessages, buildSystemPrompt, finishReply, notesMentionInjury, personMode, safeReply, SAFETY_LIMITS, type ChatLine, type CoachFlag, type SafetyText } from './safety';
import { toolKey, type SettingsStore } from './settings';
import { isToolName, runTool, TOOL_SPECS, type ToolData, type ToolSummary, type ToolTrace } from './tools';
import type { UsageStore } from './usage';
import { AiError, type Adapter, type AdapterKind, type NeutralMessage, type ProviderId, type ToolCall, type Usage } from './types';

export const ANSWER_LIMITS = { toolRounds: 6, toolCallsPerRound: 4, maxTokens: 800, maxTokensRetry: 2_400, turns: 12, reasoningChars: 6_000 } as const;

export interface AnswerDeps {
  settings: SettingsStore;
  usage: UsageStore;
  getKey: (provider: ProviderId) => Promise<string | null>;
  adapters?: Record<AdapterKind, Adapter>;
  /** The person as far as the phone and the JoyoRogo profile say (age decides the gate and the prompt). */
  person: Person;
  /** Gathers the digest source fresh for this question. */
  source: () => Promise<DigestSource>;
  data: ToolData;
  text: SafetyText;
  locale: 'id' | 'en';
  nowSec: () => number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Live events of the answer being written: a provider call starts, text and reasoning arrive, a tool starts and ends. */
  onEvent?: (event: AnswerEvent) => void;
}

export type AnswerEvent =
  /** A provider call starts (the first one, or the next after tools ran). Text from the previous call, if any, is kept. */
  | { type: 'round'; round: number }
  | { type: 'text'; delta: string }
  | { type: 'reasoning'; delta: string }
  | { type: 'toolStart'; id: string; trace: ToolTrace }
  | { type: 'toolDone'; id: string; trace: ToolTrace; summary: ToolSummary };

/** One tool the answer ran, kept with the message: what was read and how it went. */
export interface AnswerStep {
  id: string;
  trace: ToolTrace;
  summary: ToolSummary;
}

export interface Answer {
  reply: string;
  /** The fixed answer of the keyword pass was used: no provider call was made. */
  fixed: boolean;
  flagged: CoachFlag | null;
  /** What the answer read, in order: shown as "based on". */
  trace: ToolTrace[];
  /** The same tools with how each went (rows found, nothing, failed): the collapsible steps of the chat. */
  steps: AnswerStep[];
  /** The reasoning the model wrote, when it sent any. Never part of the reply. */
  reasoning: string;
  /** Notes the model suggested; the person confirms each one. */
  proposedNotes: string[];
  usage: Usage & { calls: number };
  /** This model has no tool calling: the answer used the digest alone. */
  toolsUnsupported: boolean;
  /** The digest sent, for the "what was sent" view. */
  digest: Digest | null;
}

const blocked = (reason: ByokBlock | 'ceiling'): AiError => new AiError('blocked', null, reason);

/**
 * One answer with the person's own key, end to end. Order matters and is tested:
 *  1. the gate (under 18, no key, no consent): nothing is sent;
 *  2. the keyword safety pass over the conversation: a worrying last message gets the fixed answer and NO provider call;
 *  3. the local daily call ceiling;
 *  4. the digest and system prompt, then at most 6 rounds of provider call and tool runs (all read-only, on the phone);
 *  5. the reply is cleaned, the disclaimer is added in code where needed.
 */
export async function answer(history: readonly ChatLine[], deps: AnswerDeps): Promise<Answer> {
  const settings = deps.settings.get();
  const gate = byokAccess(settings, deps.person.ageYears);
  if (!gate.ok) throw blocked(gate.reason);

  const turns = history.slice(-ANSWER_LIMITS.turns).map((t) => ({ role: t.role, content: t.content.slice(0, SAFETY_LIMITS.maxMessageChars) }));
  // Anthropic wants the first message from the user; cutting to the last turns can leave an answer in front.
  while (turns.length > 0 && turns[0]!.role !== 'user') turns.shift();
  const lastUser = [...turns].reverse().find((t) => t.role === 'user');
  if (!lastUser) throw new AiError('badRequest');

  const minor = deps.person.ageYears !== null && deps.person.ageYears < 18;
  const safety = assessMessages(turns, { minor });
  const empty = { inputTokens: 0, outputTokens: 0, calls: 0 };
  if (safety.last.reason) {
    return { reply: safeReply(safety.last.reason, deps.text), fixed: true, flagged: safety.last.flagged, trace: [], steps: [], reasoning: '', proposedNotes: [], usage: empty, toolsUnsupported: false, digest: null };
  }

  const key = await deps.getKey(gate.provider);
  if (!key) throw blocked('noKey');
  const ceiling = settings.dailyCeiling;
  if (deps.usage.today(deps.nowSec()).calls >= ceiling) throw blocked('ceiling');

  const source = await deps.source();
  const digest = buildDigest(source);
  const mode = personMode(deps.person, safety.maternalMention);
  const notesFlag = notesMentionInjury(digest.notes);
  const adapter = (deps.adapters ?? ADAPTERS)[PROVIDERS[gate.provider].adapter];

  const noTools = settings.noTools.includes(toolKey(gate.provider, gate.model));
  let toolsOn = !noTools;
  const conn = { baseUrl: gate.baseUrl, apiKey: key, model: gate.model };
  const messages: NeutralMessage[] = turns.map((t) => (t.role === 'user' ? { role: 'user', content: t.content } : { role: 'assistant', content: t.content }));
  const trace: ToolTrace[] = [];
  const steps: AnswerStep[] = [];
  const proposedNotes: string[] = [];
  const spent = { inputTokens: 0, outputTokens: 0, calls: 0 };
  let toolsUnsupported = noTools;
  let reasoning = '';
  let rounds = 0;

  const call = async (withTools: boolean, maxTokens: number) => {
    if (deps.usage.today(deps.nowSec()).calls >= ceiling) throw blocked('ceiling');
    deps.onEvent?.({ type: 'round', round: rounds });
    rounds += 1;
    const system = buildSystemPrompt({ locale: deps.locale, digestJson: digestJson(digest), safety, mode, notesFlag, tools: withTools });
    try {
      const reply = await adapter.complete(
        conn,
        { model: gate.model, system, messages, tools: withTools ? TOOL_SPECS : undefined, maxTokens },
        {
          signal: deps.signal,
          fetchImpl: deps.fetchImpl,
          onDelta: (delta) => {
            if (delta.thinking) deps.onEvent?.({ type: 'reasoning', delta: delta.thinking });
            if (delta.text) deps.onEvent?.({ type: 'text', delta: delta.text });
          },
        },
      );
      deps.usage.record(deps.nowSec(), reply.usage);
      spent.calls += 1;
      spent.inputTokens += reply.usage?.inputTokens ?? 0;
      spent.outputTokens += reply.usage?.outputTokens ?? 0;
      if (reply.thinking && reasoning.length < ANSWER_LIMITS.reasoningChars) reasoning = `${reasoning}${reasoning ? '\n\n' : ''}${reply.thinking}`.slice(0, ANSWER_LIMITS.reasoningChars);
      return reply;
    } catch (error) {
      // The provider answered, so it still counts against the ceiling even when it refused.
      if (error instanceof AiError && error.status !== null) deps.usage.record(deps.nowSec(), null);
      throw error;
    }
  };

  /** One provider call; a thinking model that used its whole budget thinking gets one more try with more room (it counts as a call). */
  const callWithRetry = async (withTools: boolean) => {
    try {
      return await call(withTools, ANSWER_LIMITS.maxTokens);
    } catch (error) {
      if (error instanceof AiError && error.kind === 'truncated') return call(withTools, ANSWER_LIMITS.maxTokensRetry);
      throw error;
    }
  };

  let text = '';
  let finish: string | null = null;
  for (let round = 0; ; round++) {
    let reply;
    try {
      reply = await callWithRetry(toolsOn);
    } catch (error) {
      // A model without tool calling: remember it and answer from the digest alone.
      if (toolsOn && error instanceof AiError && error.kind === 'noTools') {
        toolsOn = false;
        toolsUnsupported = true;
        deps.settings.update((s) => ({ noTools: [...new Set([...s.noTools, toolKey(gate.provider, gate.model)])] }));
        reply = await callWithRetry(false);
      } else throw error;
    }
    finish = reply.finish;
    if (reply.toolCalls.length === 0 || !toolsOn) {
      text = reply.text;
      break;
    }
    const calls: ToolCall[] = reply.toolCalls.slice(0, ANSWER_LIMITS.toolCallsPerRound);
    messages.push({ role: 'assistant', content: reply.text, toolCalls: calls, ...(reply.thinking ? { reasoning: reply.thinking } : {}) });
    for (const toolCall of calls) {
      deps.onEvent?.({ type: 'toolStart', id: toolCall.id, trace: { tool: isToolName(toolCall.name) ? toolCall.name : 'get_daily', args: {} } });
      const outcome = await runTool(toolCall, deps.data);
      trace.push(outcome.trace);
      steps.push({ id: toolCall.id, trace: outcome.trace, summary: outcome.summary });
      deps.onEvent?.({ type: 'toolDone', id: toolCall.id, trace: outcome.trace, summary: outcome.summary });
      if (outcome.proposedNote) proposedNotes.push(outcome.proposedNote);
      messages.push({ role: 'tool', callId: toolCall.id, name: toolCall.name, content: outcome.content });
      if (deps.signal?.aborted) throw new AiError('aborted');
    }
    if (round + 1 >= ANSWER_LIMITS.toolRounds) {
      // The round limit is reached: ask for the answer without tools.
      toolsOn = false;
      messages.push({ role: 'user', content: 'Answer now with what you have, without more tool calls.' });
    }
  }

  const finished = finishReply(text, { text: deps.text, lastUserText: lastUser.content, mode });
  if (finished === null) throw new AiError('empty', null, `finish_reason=${finish ?? 'none'}; the answer held only reasoning tags or markup (${text.length} chars)`);
  return { reply: finished, fixed: false, flagged: null, trace, steps, reasoning, proposedNotes, usage: spent, toolsUnsupported, digest };
}

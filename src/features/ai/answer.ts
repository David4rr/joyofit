import { ADAPTERS } from './adapters';
import { byokAccess, type ByokBlock } from './access';
import { buildDigest, digestJson, type Digest, type DigestSource } from './digest';
import type { Person } from './person';
import { assessMessages, buildSystemPrompt, finishReply, notesMentionInjury, personMode, safeReply, SAFETY_LIMITS, type ChatLine, type CoachFlag, type SafetyText } from './safety';
import { toolKey, type SettingsStore } from './settings';
import { runTool, TOOL_SPECS, type ToolData, type ToolTrace } from './tools';
import type { UsageStore } from './usage';
import { AiError, type Adapter, type AdapterKind, type NeutralMessage, type ProviderId, type ToolCall, type Usage } from './types';

export const ANSWER_LIMITS = { toolRounds: 6, toolCallsPerRound: 4, maxTokens: 800, turns: 12 } as const;

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
  /** Called before each provider call and each tool, for the status line ("reading sleep of 7 days"). */
  onStatus?: (status: { kind: 'thinking' } | { kind: 'tool'; trace: ToolTrace }) => void;
}

export interface Answer {
  reply: string;
  /** The fixed answer of the keyword pass was used: no provider call was made. */
  fixed: boolean;
  flagged: CoachFlag | null;
  /** What the answer read, in order: shown as "based on". */
  trace: ToolTrace[];
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
  const lastUser = [...turns].reverse().find((t) => t.role === 'user');
  if (!lastUser) throw new AiError('badRequest');

  const minor = deps.person.ageYears !== null && deps.person.ageYears < 18;
  const safety = assessMessages(turns, { minor });
  const empty = { inputTokens: 0, outputTokens: 0, calls: 0 };
  if (safety.last.reason) {
    return { reply: safeReply(safety.last.reason, deps.text), fixed: true, flagged: safety.last.flagged, trace: [], proposedNotes: [], usage: empty, toolsUnsupported: false, digest: null };
  }

  const key = await deps.getKey(gate.provider);
  if (!key) throw blocked('noKey');
  const ceiling = settings.dailyCeiling;
  if (deps.usage.today(deps.nowSec()).calls >= ceiling) throw blocked('ceiling');

  const source = await deps.source();
  const digest = buildDigest(source);
  const mode = personMode(deps.person, safety.maternalMention);
  const notesFlag = notesMentionInjury(digest.notes);
  const adapter = (deps.adapters ?? ADAPTERS)[gate.provider === 'anthropic' ? 'anthropic' : 'openai'];

  const noTools = settings.noTools.includes(toolKey(gate.provider, gate.model));
  let toolsOn = !noTools;
  const conn = { baseUrl: gate.baseUrl, apiKey: key, model: gate.model };
  const messages: NeutralMessage[] = turns.map((t) => (t.role === 'user' ? { role: 'user', content: t.content } : { role: 'assistant', content: t.content }));
  const trace: ToolTrace[] = [];
  const proposedNotes: string[] = [];
  const spent = { inputTokens: 0, outputTokens: 0, calls: 0 };
  let toolsUnsupported = noTools;

  const call = async (withTools: boolean) => {
    if (deps.usage.today(deps.nowSec()).calls >= ceiling) throw blocked('ceiling');
    deps.onStatus?.({ kind: 'thinking' });
    const system = buildSystemPrompt({ locale: deps.locale, digestJson: digestJson(digest), safety, mode, notesFlag, tools: withTools });
    try {
      const reply = await adapter.complete(conn, { model: gate.model, system, messages, tools: withTools ? TOOL_SPECS : undefined, maxTokens: ANSWER_LIMITS.maxTokens }, { signal: deps.signal, fetchImpl: deps.fetchImpl });
      deps.usage.record(deps.nowSec(), reply.usage);
      spent.calls += 1;
      spent.inputTokens += reply.usage?.inputTokens ?? 0;
      spent.outputTokens += reply.usage?.outputTokens ?? 0;
      return reply;
    } catch (error) {
      // The provider answered, so it still counts against the ceiling even when it refused.
      if (error instanceof AiError && error.status !== null) deps.usage.record(deps.nowSec(), null);
      throw error;
    }
  };

  let text = '';
  for (let round = 0; ; round++) {
    let reply;
    try {
      reply = await call(toolsOn);
    } catch (error) {
      // A model without tool calling: remember it and answer from the digest alone.
      if (toolsOn && error instanceof AiError && error.kind === 'noTools') {
        toolsOn = false;
        toolsUnsupported = true;
        deps.settings.update((s) => ({ noTools: [...new Set([...s.noTools, toolKey(gate.provider, gate.model)])] }));
        reply = await call(false);
      } else throw error;
    }
    if (reply.toolCalls.length === 0 || !toolsOn) {
      text = reply.text;
      break;
    }
    const calls: ToolCall[] = reply.toolCalls.slice(0, ANSWER_LIMITS.toolCallsPerRound);
    messages.push({ role: 'assistant', content: reply.text, toolCalls: calls });
    for (const toolCall of calls) {
      const outcome = await runTool(toolCall, deps.data);
      trace.push(outcome.trace);
      deps.onStatus?.({ kind: 'tool', trace: outcome.trace });
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
  if (finished === null) throw new AiError('empty');
  return { reply: finished, fixed: false, flagged: null, trace, proposedNotes, usage: spent, toolsUnsupported, digest };
}

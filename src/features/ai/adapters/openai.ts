import { isRecord, type Json } from '../json';
import { PROVIDERS } from '../providers';
import type { Adapter, CallOptions, ModelInfo, ModelReply, ModelRequest, NeutralMessage, ProviderConnection, StreamDelta, ToolCall, Usage } from '../types';
import { AiError } from '../types';
import { CALL_TIMEOUT_MS, LIST_TIMEOUT_MS, postJson, postStream } from './http';
import { createThinkSplitter, splitThink } from './sse';

/** Models that answer chat completions; the embeddings, speech, image and moderation ones in a provider's list are not offered. */
const NOT_CHAT = /embed|whisper|tts|transcribe|dall-e|image|moderation|audio|realtime|rerank|speech|video|imagen|veo|lyria|computer-use|search-preview/i;

/**
 * Thinking models (OpenAI's, GLM, DeepSeek, Qwen, Kimi, Gemini) count their reasoning against the output limit, so an answer limit of
 * 800 can be spent entirely on thinking and leave no answer. The limit sent to the provider is the answer budget plus this room.
 */
export const OPENAI_HEADROOM = 2_400;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** The provider that owns `baseUrl`, to pick its quirks (token field name, reasoning effort). Unknown hosts get the plain defaults. */
function quirks(baseUrl: string) {
  const known = Object.values(PROVIDERS).find((p) => p.baseUrl !== '' && baseUrl.startsWith(p.baseUrl));
  return known ?? PROVIDERS.custom;
}

function toWire(message: NeutralMessage): Json {
  if (message.role === 'user') return { role: 'user', content: message.content };
  if (message.role === 'tool') return { role: 'tool', tool_call_id: message.callId, content: message.content };
  const wire: Json = { role: 'assistant', content: message.content === '' && message.toolCalls?.length ? null : message.content };
  if (message.toolCalls?.length) {
    wire.tool_calls = message.toolCalls.map((call) => ({
      id: call.id,
      type: 'function',
      function: { name: call.name, arguments: JSON.stringify(call.args) },
    }));
    // DeepSeek and GLM thinking modes want the reasoning back in the rounds that call tools; only sent when the server gave one.
    if (message.reasoning) wire.reasoning_content = message.reasoning;
  }
  return wire;
}

/** The body of `POST {baseUrl}/chat/completions`. Exported for the request-mapping tests. */
export function buildOpenAiBody(baseUrl: string, request: ModelRequest, opts: { stream?: boolean; usage?: boolean } = {}): Json {
  const q = quirks(baseUrl);
  const body: Json = {
    model: request.model,
    messages: [{ role: 'system', content: request.system }, ...request.messages.map(toWire)],
    [q.maxTokensField]: request.maxTokens + OPENAI_HEADROOM,
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  }
  if (q.reasoningEffort) body.reasoning_effort = q.reasoningEffort;
  if (opts.stream) {
    body.stream = true;
    // Every compatible server that streams is asked for the token count; one that refuses is remembered (`refusedUsage`) and asked without.
    if (opts.usage ?? q.streamUsage) body.stream_options = { include_usage: true };
  }
  return body;
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (isRecord(raw)) return raw;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const value: unknown = JSON.parse(raw);
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
}

/** Reasoning text in any of the shapes servers use: `reasoning_content` (GLM, DeepSeek, Qwen, Kimi), `reasoning` (OpenRouter, LM Studio), `thinking`, or OpenRouter's `reasoning_details`. */
export function reasoningOf(source: Json): string {
  for (const key of ['reasoning_content', 'reasoning', 'thinking']) {
    const value = source[key];
    if (typeof value === 'string' && value !== '') return value;
  }
  const details = source.reasoning_details;
  if (Array.isArray(details)) {
    return details.map((d) => (isRecord(d) ? str(d.text) || str(d.summary) : '')).join('');
  }
  return '';
}

/** Answer text and reasoning from a `content` that is a string, or a list of parts (some servers, and Anthropic-style gateways, answer with parts). */
function contentOf(raw: unknown): { text: string; thinking: string } {
  if (typeof raw === 'string') return { text: raw, thinking: '' };
  if (!Array.isArray(raw)) return { text: '', thinking: '' };
  let text = '';
  let thinking = '';
  for (const part of raw) {
    if (typeof part === 'string') text += part;
    else if (isRecord(part)) {
      const body = str(part.text) || str(part.content);
      if (part.type === 'thinking' || part.type === 'reasoning') thinking += str(part.thinking) || body;
      else text += body;
    }
  }
  return { text, thinking };
}

function usageOf(raw: unknown): Usage | null {
  if (!isRecord(raw)) return null;
  const input = Number(raw.prompt_tokens ?? raw.input_tokens) || 0;
  const output = Number(raw.completion_tokens ?? raw.output_tokens) || 0;
  return input === 0 && output === 0 && raw.prompt_tokens === undefined ? null : { inputTokens: input, outputTokens: output };
}

interface Parts {
  text: string;
  thinking: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  finish: string | null;
  status: number;
}

/** Turns what was read into a reply, or the error that says why there is no answer. */
function finishReply(parts: Parts): ModelReply {
  const { text, thinking, toolCalls, finish } = parts;
  if (toolCalls.length === 0 && text.trim() === '') {
    const detail = `finish_reason=${finish ?? 'none'}; answer=${text.length} chars; reasoning=${thinking.length} chars`;
    throw new AiError(finish === 'length' ? 'truncated' : 'empty', parts.status, detail);
  }
  const stop = toolCalls.length > 0 ? 'tools' : finish === 'length' ? 'length' : finish === 'stop' || finish == null ? 'end' : 'other';
  return { text, thinking, toolCalls, usage: parts.usage, stop, finish };
}

/** Reads a chat completion. Exported for the response-mapping tests. */
export function parseOpenAiReply(body: unknown, status = 200): ModelReply {
  if (!isRecord(body)) throw new AiError('server', status, 'the answer was not a JSON object');
  const choice = Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  if (!message) throw new AiError('empty', status, 'no message in the answer (choices is empty)');
  const content = contentOf(message.content);
  // Reasoning can ride in its own field, in content parts, or inline as <think> tags.
  const inline = splitThink(content.text);
  const toolCalls: ToolCall[] = [];
  if (Array.isArray(message.tool_calls)) {
    message.tool_calls.forEach((raw, index) => {
      if (!isRecord(raw) || !isRecord(raw.function) || typeof raw.function.name !== 'string') return;
      toolCalls.push({
        // Gemini's compatible endpoint can leave the id empty; the tool result must still point at something.
        id: typeof raw.id === 'string' && raw.id !== '' ? raw.id : `call_${index}`,
        name: raw.function.name,
        args: parseArgs(raw.function.arguments),
      });
    });
  } else if (isRecord(message.function_call) && typeof message.function_call.name === 'string') {
    // The older single-call shape.
    toolCalls.push({ id: 'call_0', name: message.function_call.name, args: parseArgs(message.function_call.arguments) });
  }
  return finishReply({
    text: inline.text,
    thinking: reasoningOf(message) || content.thinking || inline.thinking,
    toolCalls,
    usage: usageOf(body.usage),
    finish: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    status,
  });
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
}

/** Collects the chunks of a streamed chat completion into the same reply the non-streaming call returns. */
export function createOpenAiStream(onDelta: ((delta: StreamDelta) => void) | undefined, status = 200) {
  const splitter = createThinkSplitter();
  let text = '';
  let thinking = '';
  let usage: Usage | null = null;
  let finish: string | null = null;
  const calls = new Map<string, PendingCall>();
  let lastKey = '';
  let anonymous = 0;

  const emit = (delta: StreamDelta) => {
    const piece: StreamDelta = {};
    if (delta.text) piece.text = delta.text;
    if (delta.thinking) piece.thinking = delta.thinking;
    if (piece.text === undefined && piece.thinking === undefined) return;
    text += piece.text ?? '';
    thinking += piece.thinking ?? '';
    onDelta?.(piece);
  };

  return {
    /** One `data:` payload. `[DONE]` and anything that is not JSON are ignored. */
    push(data: string): void {
      if (data === '[DONE]') return;
      let chunk: unknown;
      try {
        chunk = JSON.parse(data);
      } catch {
        return;
      }
      if (!isRecord(chunk)) return;
      // Some servers report a failure inside the stream instead of as an HTTP status.
      if (isRecord(chunk.error)) throw new AiError('server', status, str(chunk.error.message).slice(0, 240) || 'error event in the stream');
      usage = usageOf(chunk.usage) ?? usage;
      const choice = Array.isArray(chunk.choices) && isRecord(chunk.choices[0]) ? chunk.choices[0] : null;
      if (!choice) return;
      if (typeof choice.finish_reason === 'string') finish = choice.finish_reason;
      const delta = isRecord(choice.delta) ? choice.delta : isRecord(choice.message) ? choice.message : null;
      if (!delta) return;
      const reasoning = reasoningOf(delta);
      if (reasoning) emit({ thinking: reasoning });
      const content = contentOf(delta.content);
      if (content.thinking) emit({ thinking: content.thinking });
      if (content.text) emit(splitter.push(content.text));
      if (Array.isArray(delta.tool_calls)) {
        for (const raw of delta.tool_calls) {
          if (!isRecord(raw)) continue;
          const fn = isRecord(raw.function) ? raw.function : {};
          const id = str(raw.id);
          const name = str(fn.name);
          let key: string;
          if (typeof raw.index === 'number') key = `i${raw.index}`;
          else if (id !== '') key = `d${id}`;
          else if (name !== '' || lastKey === '') key = `a${anonymous++}`;
          else key = lastKey;
          lastKey = key;
          const pending = calls.get(key) ?? { id: '', name: '', args: '' };
          if (id) pending.id = id;
          if (name) pending.name += name;
          if (typeof fn.arguments === 'string') pending.args += fn.arguments;
          else if (isRecord(fn.arguments)) pending.args = JSON.stringify(fn.arguments);
          calls.set(key, pending);
        }
      }
    },
    result(): ModelReply {
      emit(splitter.end());
      const toolCalls: ToolCall[] = [...calls.values()]
        .filter((c) => c.name !== '')
        .map((c, index) => ({ id: c.id || `call_${index}`, name: c.name, args: parseArgs(c.args) }));
      return finishReply({ text, thinking, toolCalls, usage, finish, status });
    },
  };
}

/** Hosts that answered 400 or 422 to `stream_options`: asked without it from then on (until the app restarts). */
const refusedUsage = new Set<string>();
/** Hosts that refused `stream` itself: answered without streaming from then on. */
const refusedStream = new Set<string>();

function hostKey(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** For tests: forget what servers refused. */
export function resetStreamMemory(): void {
  refusedUsage.clear();
  refusedStream.clear();
}

const refusal = (error: unknown): boolean => error instanceof AiError && error.kind === 'badRequest' && error.status !== null;

async function complete(conn: ProviderConnection, request: ModelRequest, options: CallOptions = {}): Promise<ModelReply> {
  const url = `${conn.baseUrl}/chat/completions`;
  const headers = { Authorization: `Bearer ${conn.apiKey}` };
  const host = hostKey(conn.baseUrl);
  if (options.onDelta && !refusedStream.has(host)) {
    // First with token usage, then without it, then not streaming: each step only after the server said 400 or 422 to the one before.
    for (const usage of refusedUsage.has(host) ? [false] : [true, false]) {
      const stream = createOpenAiStream(options.onDelta);
      try {
        const outcome = await postStream(url, { headers, body: buildOpenAiBody(conn.baseUrl, request, { stream: true, usage }) }, options, conn.apiKey, (event) => stream.push(event.data));
        if (outcome === 'done') return stream.result();
        options.mark?.('no-stream-body');
        refusedStream.add(host);
        break;
      } catch (error) {
        if (!refusal(error)) throw error;
        options.mark?.('stream-refused', { usage: usage ? 1 : 0 });
        if (usage) refusedUsage.add(host);
        else refusedStream.add(host);
      }
    }
  }
  const body = await postJson(url, { method: 'POST', headers, body: buildOpenAiBody(conn.baseUrl, request) }, options, CALL_TIMEOUT_MS, conn.apiKey);
  const reply = parseOpenAiReply(body);
  // A runtime or server that could not stream still shows the answer: hand it over in one piece.
  if (options.onDelta) options.onDelta({ ...(reply.thinking ? { thinking: reply.thinking } : {}), ...(reply.text ? { text: reply.text } : {}) });
  return reply;
}

export function parseOpenAiModels(body: unknown): ModelInfo[] {
  const list = isRecord(body) ? (Array.isArray(body.data) ? body.data : Array.isArray(body.models) ? body.models : null) : null;
  if (!list) return [];
  const out: ModelInfo[] = [];
  for (const raw of list) {
    if (!isRecord(raw) || typeof raw.id !== 'string') continue;
    // Gemini lists `models/gemini-...`; chat completions want the bare name.
    const id = raw.id.replace(/^models\//, '');
    if (NOT_CHAT.test(id)) continue;
    const supported = raw.supported_parameters;
    out.push({ id, tools: Array.isArray(supported) ? supported.includes('tools') : null });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

export const openAiAdapter: Adapter = {
  complete,
  async listModels(conn, options = {}) {
    const body = await postJson(`${conn.baseUrl}/models`, { method: 'GET', headers: { Authorization: `Bearer ${conn.apiKey}` } }, options, LIST_TIMEOUT_MS, conn.apiKey);
    return parseOpenAiModels(body);
  },
};

import { PROVIDERS } from '../providers';
import type { Adapter, CallOptions, ModelInfo, ModelReply, ModelRequest, NeutralMessage, ProviderConnection, ToolCall } from '../types';
import { AiError } from '../types';
import { CALL_TIMEOUT_MS, LIST_TIMEOUT_MS, postJson } from './http';

/** Models that answer chat completions; the embeddings, speech, image and moderation ones in a provider's list are not offered. */
const NOT_CHAT = /embed|whisper|tts|transcribe|dall-e|image|moderation|audio|realtime|rerank|speech|video|imagen|veo|lyria|computer-use|search-preview/i;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

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
  }
  return wire;
}

/** The body of `POST {baseUrl}/chat/completions`. Exported for the request-mapping tests. */
export function buildOpenAiBody(baseUrl: string, request: ModelRequest): Json {
  const q = quirks(baseUrl);
  const body: Json = {
    model: request.model,
    messages: [{ role: 'system', content: request.system }, ...request.messages.map(toWire)],
    [q.maxTokensField]: request.maxTokens,
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } }));
  }
  if (q.reasoningEffort) body.reasoning_effort = q.reasoningEffort;
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

/** Reads a chat completion. Exported for the response-mapping tests. */
export function parseOpenAiReply(body: unknown): ModelReply {
  if (!isRecord(body)) throw new AiError('server');
  const choice = Array.isArray(body.choices) && isRecord(body.choices[0]) ? body.choices[0] : null;
  const message = choice && isRecord(choice.message) ? choice.message : null;
  if (!message) throw new AiError('empty');
  const rawContent = message.content;
  // Some compatible servers answer with content parts instead of a string.
  const text =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((part) => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('')
        : '';
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
  }
  const usage = isRecord(body.usage)
    ? { inputTokens: Number(body.usage.prompt_tokens) || 0, outputTokens: Number(body.usage.completion_tokens) || 0 }
    : null;
  const finish = choice?.finish_reason;
  const stop = toolCalls.length > 0 ? 'tools' : finish === 'length' ? 'length' : finish === 'stop' || finish == null ? 'end' : 'other';
  return { text, toolCalls, usage, stop };
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
  async complete(conn: ProviderConnection, request: ModelRequest, options: CallOptions = {}): Promise<ModelReply> {
    const body = await postJson(
      `${conn.baseUrl}/chat/completions`,
      { method: 'POST', headers: { Authorization: `Bearer ${conn.apiKey}` }, body: buildOpenAiBody(conn.baseUrl, request) },
      options,
      CALL_TIMEOUT_MS,
      conn.apiKey,
    );
    return parseOpenAiReply(body);
  },
  async listModels(conn, options = {}) {
    const body = await postJson(`${conn.baseUrl}/models`, { method: 'GET', headers: { Authorization: `Bearer ${conn.apiKey}` } }, options, LIST_TIMEOUT_MS, conn.apiKey);
    return parseOpenAiModels(body);
  },
};

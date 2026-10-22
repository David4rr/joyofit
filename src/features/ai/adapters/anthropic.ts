import type { Adapter, CallOptions, ModelInfo, ModelReply, ModelRequest, NeutralMessage, ProviderConnection, ToolCall } from '../types';
import { AiError } from '../types';
import { CALL_TIMEOUT_MS, LIST_TIMEOUT_MS, postJson } from './http';

export const ANTHROPIC_VERSION = '2023-06-01';
/** Claude 5 models think adaptively and thinking tokens count against `max_tokens`; the headroom keeps a short answer from being cut off by it. */
export const THINKING_HEADROOM = 1200;
/** Claude 5 models take `output_config.effort`; older ones do not, so it is only sent for these. */
const EFFORT_MODELS = /^claude-(haiku|sonnet|opus|fable|mythos)-5/;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Anthropic wants strictly alternating roles: tool results ride in a user turn, and neighbours of one role are merged. */
function toWireMessages(messages: readonly NeutralMessage[]): Json[] {
  const wire: Json[] = [];
  const push = (role: 'user' | 'assistant', blocks: Json[]) => {
    const last = wire.at(-1);
    if (last && last.role === role) (last.content as Json[]).push(...blocks);
    else wire.push({ role, content: blocks });
  };
  for (const message of messages) {
    if (message.role === 'user') push('user', [{ type: 'text', text: message.content }]);
    else if (message.role === 'tool') push('user', [{ type: 'tool_result', tool_use_id: message.callId, content: message.content }]);
    else {
      const blocks: Json[] = [];
      if (message.content !== '') blocks.push({ type: 'text', text: message.content });
      for (const call of message.toolCalls ?? []) blocks.push({ type: 'tool_use', id: call.id, name: call.name, input: call.args });
      if (blocks.length > 0) push('assistant', blocks);
    }
  }
  return wire;
}

/** The body of `POST {baseUrl}/v1/messages`. Exported for the request-mapping tests. */
export function buildAnthropicBody(request: ModelRequest): Json {
  const body: Json = {
    model: request.model,
    max_tokens: request.maxTokens + THINKING_HEADROOM,
    system: request.system,
    messages: toWireMessages(request.messages),
  };
  if (request.tools?.length) {
    body.tools = request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters }));
  }
  if (EFFORT_MODELS.test(request.model)) body.output_config = { effort: 'low' };
  return body;
}

/** Reads a Messages answer. Exported for the response-mapping tests. */
export function parseAnthropicReply(body: unknown): ModelReply {
  if (!isRecord(body) || !Array.isArray(body.content)) throw new AiError('server');
  let text = '';
  const toolCalls: ToolCall[] = [];
  for (const block of body.content) {
    if (!isRecord(block)) continue;
    if (block.type === 'text' && typeof block.text === 'string') text += block.text;
    else if (block.type === 'tool_use' && typeof block.id === 'string' && typeof block.name === 'string') {
      toolCalls.push({ id: block.id, name: block.name, args: isRecord(block.input) ? block.input : {} });
    }
  }
  const usage = isRecord(body.usage)
    ? { inputTokens: Number(body.usage.input_tokens) || 0, outputTokens: Number(body.usage.output_tokens) || 0 }
    : null;
  const reason = body.stop_reason;
  const stop = toolCalls.length > 0 ? 'tools' : reason === 'max_tokens' ? 'length' : reason === 'end_turn' || reason === 'stop_sequence' ? 'end' : 'other';
  return { text, toolCalls, usage, stop };
}

export function parseAnthropicModels(body: unknown): ModelInfo[] {
  if (!isRecord(body) || !Array.isArray(body.data)) return [];
  const out: ModelInfo[] = [];
  for (const raw of body.data) {
    if (isRecord(raw) && typeof raw.id === 'string') out.push({ id: raw.id, tools: true });
  }
  return out;
}

const headers = (key: string): Record<string, string> => ({ 'x-api-key': key, 'anthropic-version': ANTHROPIC_VERSION });

export const anthropicAdapter: Adapter = {
  async complete(conn: ProviderConnection, request: ModelRequest, options: CallOptions = {}): Promise<ModelReply> {
    const body = await postJson(
      `${conn.baseUrl}/v1/messages`,
      { method: 'POST', headers: headers(conn.apiKey), body: buildAnthropicBody(request) },
      options,
      CALL_TIMEOUT_MS,
      conn.apiKey,
    );
    return parseAnthropicReply(body);
  },
  async listModels(conn, options = {}) {
    const body = await postJson(`${conn.baseUrl}/v1/models?limit=100`, { method: 'GET', headers: headers(conn.apiKey) }, options, LIST_TIMEOUT_MS, conn.apiKey);
    return parseAnthropicModels(body);
  },
};

/**
 * Joyo AI with the person's own key (BYOK): the neutral shapes the digest, the tools and the two provider adapters share.
 * Nothing in this folder talks to JoyoRogo's AI; the phone calls the provider directly and the key never leaves it.
 */

export const PROVIDER_IDS = ['openrouter', 'openai', 'anthropic', 'gemini', 'custom'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

/** The request format a provider speaks: OpenAI chat completions (OpenAI, OpenRouter, Gemini's compatible endpoint, custom) or Anthropic Messages. */
export type AdapterKind = 'openai' | 'anthropic';

/** Which chat the person uses: JoyoRogo's hosted coach (Pro) or their own key. */
export type Engine = 'rogo' | 'byok';

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** A conversation turn in neutral form; each adapter translates it. */
export type NeutralMessage =
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string; toolCalls?: ToolCall[] }
  | { role: 'tool'; callId: string; name: string; content: string };

/** JSON Schema subset the tools use. */
export interface ToolSchema {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolSchema;
}

export interface ModelRequest {
  model: string;
  system: string;
  messages: readonly NeutralMessage[];
  tools?: readonly ToolSpec[];
  maxTokens: number;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface ModelReply {
  text: string;
  toolCalls: ToolCall[];
  usage: Usage | null;
  stop: 'end' | 'tools' | 'length' | 'other';
}

/** What went wrong with a provider call, worded for the person by the UI (`ai:errors.<kind>`). */
export type AiErrorKind =
  | 'badKey'
  | 'forbidden'
  | 'quota'
  | 'rateLimit'
  | 'modelNotFound'
  | 'noTools'
  | 'badRequest'
  | 'server'
  | 'network'
  | 'timeout'
  | 'empty'
  | 'aborted'
  /** Not allowed to call: no consent, no key, under 18, daily ceiling. Nothing was sent. */
  | 'blocked';

export class AiError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    readonly status: number | null = null,
    /** The provider's own message, for the details line. Never contains the key. */
    readonly detail: string | null = null,
  ) {
    super(`ai-${kind}`);
  }
}

export interface ProviderConnection {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ModelInfo {
  id: string;
  /** False when the provider's list says the model has no tool calling; null when the list does not say. */
  tools: boolean | null;
}

export interface CallOptions {
  signal?: AbortSignal;
  /** Deadline of one provider call. */
  timeoutMs?: number;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

export interface Adapter {
  complete(conn: ProviderConnection, request: ModelRequest, options?: CallOptions): Promise<ModelReply>;
  listModels(conn: Pick<ProviderConnection, 'baseUrl' | 'apiKey'>, options?: CallOptions): Promise<ModelInfo[]>;
}

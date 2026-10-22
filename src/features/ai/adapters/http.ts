import { AiError, type AiErrorKind, type CallOptions } from '../types';

/** The deadline of one provider call (the hosted coach uses the same 25 s). */
export const CALL_TIMEOUT_MS = 25_000;
/** Listing models is a plain read; give it less time than an answer. */
export const LIST_TIMEOUT_MS = 15_000;

const MAX_BODY_CHARS = 400_000;

function cleanDetail(text: string | null | undefined, key: string): string | null {
  if (!text) return null;
  let out = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  // A provider may echo a truncated key back in its error; never show or keep it.
  if (key.length >= 8) out = out.split(key).join('[key]');
  out = out.replace(/\b(sk-[A-Za-z0-9_-]{6})[A-Za-z0-9_-]*/g, '$1...').replace(/\bAIza[A-Za-z0-9_-]{4}[A-Za-z0-9_-]*/g, 'AIza...');
  return out.slice(0, 240) || null;
}

/** Pulls the message out of the usual error bodies: `{error:{message}}`, `{error:"text"}`, `{message}`, `[{error:{message}}]`. */
export function errorMessageOf(body: unknown): string | null {
  const first = Array.isArray(body) ? body[0] : body;
  if (typeof first === 'string') return first;
  if (typeof first !== 'object' || first === null) return null;
  const record = first as Record<string, unknown>;
  const error = record.error;
  if (typeof error === 'string') return error;
  if (typeof error === 'object' && error !== null) {
    const message = (error as Record<string, unknown>).message;
    if (typeof message === 'string') return message;
  }
  return typeof record.message === 'string' ? record.message : null;
}

const QUOTA_WORDS = /insufficient[_ ]quota|credit balance|billing|insufficient (credits|funds)|out of credits|exceeded your current quota|payment required|quota exceeded|resource[_ ]exhausted/i;
const TOOLS_WORDS = /tool|function[_ ]call/i;
const NO_SUPPORT = /not support|unsupported|does not allow|no endpoints? found|doesn't support|cannot use|invalid.*tool/i;

/** Maps a provider's HTTP failure to a cause the person can act on. The status decides first, then the provider's own words. */
export function kindForStatus(status: number, message: string | null): AiErrorKind {
  const text = message ?? '';
  if (status === 401) return 'badKey';
  if (status === 402) return 'quota';
  if (status === 403) return QUOTA_WORDS.test(text) ? 'quota' : 'forbidden';
  if (status === 404) return TOOLS_WORDS.test(text) && NO_SUPPORT.test(text) ? 'noTools' : 'modelNotFound';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429) return QUOTA_WORDS.test(text) ? 'quota' : 'rateLimit';
  if (status === 400 || status === 422) {
    if (QUOTA_WORDS.test(text)) return 'quota';
    if (TOOLS_WORDS.test(text) && NO_SUPPORT.test(text)) return 'noTools';
    if (/model/i.test(text) && /(not found|does not exist|unknown|invalid model|no such)/i.test(text)) return 'modelNotFound';
    if (/api key|authentication|invalid x-api-key/i.test(text)) return 'badKey';
    return 'badRequest';
  }
  if (status >= 500 || status === 529) return 'server';
  return 'badRequest';
}

/**
 * One JSON request with a deadline and the caller's abort signal. Failures become an {@link AiError}: no answer in time is
 * `timeout`, a refused connection `network`, the caller's own abort `aborted`. The key is only ever put in `headers` and is
 * stripped from every message kept from an error.
 */
export async function postJson(
  url: string,
  init: { method: 'GET' | 'POST'; headers: Record<string, string>; body?: unknown },
  options: CallOptions,
  defaultTimeoutMs: number,
  key: string,
): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, options.timeoutMs ?? defaultTimeoutMs);
  const outer = options.signal;
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) {
      clearTimeout(timer);
      throw new AiError('aborted');
    }
    outer.addEventListener('abort', onAbort, { once: true });
  }
  try {
    let response: Response;
    let text: string;
    try {
      response = await doFetch(url, {
        method: init.method,
        headers: { Accept: 'application/json', ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...init.headers },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
        signal: controller.signal,
        credentials: 'omit',
      });
      text = (await response.text()).slice(0, MAX_BODY_CHARS);
    } catch {
      if (outer?.aborted) throw new AiError('aborted');
      throw new AiError(timedOut ? 'timeout' : 'network');
    }
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    if (!response.ok) {
      const message = errorMessageOf(body) ?? (body === null ? text : null);
      throw new AiError(kindForStatus(response.status, message), response.status, cleanDetail(message, key));
    }
    if (body === null) throw new AiError('server', response.status, cleanDetail(text, key));
    return body;
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', onAbort);
  }
}

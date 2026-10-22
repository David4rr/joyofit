import Storage from 'expo-sqlite/kv-store';

import { PROVIDER_IDS, type ProviderId } from '@/features/ai/types';
import { TOOL_NAMES, type ToolTrace } from '@/features/ai/tools';
import type { ChatTurn } from './api';

/**
 * A stored turn: the text, and for an own-key (Joyo AI) answer what it read (`trace`, tool names and dates, never values), which
 * model wrote it, and the notes it suggested that the person has not answered yet (`proposed`). Turns saved before these fields
 * existed are plain `ChatTurn`s and read the same.
 */
export interface StoredTurn extends ChatTurn {
  trace?: ToolTrace[];
  provider?: ProviderId;
  model?: string;
  proposed?: string[];
}

/**
 * The conversation stays on the phone (the server stores no messages), as the last 40 turns in the kv-store. "Clear" empties it.
 * Reads never throw: a damaged value is an empty conversation.
 */
const KEY = 'joyofit.coach.chat';
const KEEP = 40;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isTrace = (v: unknown): v is ToolTrace =>
  isObject(v) &&
  typeof v.tool === 'string' &&
  (TOOL_NAMES as readonly string[]).includes(v.tool) &&
  isObject(v.args) &&
  Object.values(v.args).every((a) => typeof a === 'string' || typeof a === 'number');

/** One stored value as a turn, keeping the optional fields that are valid and dropping the rest. Null when it is not a turn. */
function toTurn(value: unknown): StoredTurn | null {
  if (!isObject(value) || (value.role !== 'user' && value.role !== 'assistant') || typeof value.content !== 'string') return null;
  const turn: StoredTurn = { role: value.role, content: value.content };
  if (Array.isArray(value.trace)) turn.trace = value.trace.filter(isTrace);
  if (typeof value.provider === 'string' && (PROVIDER_IDS as readonly string[]).includes(value.provider)) turn.provider = value.provider as ProviderId;
  if (typeof value.model === 'string') turn.model = value.model.slice(0, 200);
  if (Array.isArray(value.proposed)) {
    const proposed = value.proposed.filter((n): n is string => typeof n === 'string' && n.length > 0);
    if (proposed.length > 0) turn.proposed = proposed;
  }
  return turn;
}

export function readChat(): StoredTurn[] {
  try {
    const value: unknown = JSON.parse(Storage.getItemSync(KEY) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.map(toTurn).filter((turn): turn is StoredTurn => turn !== null);
  } catch {
    return [];
  }
}

export function writeChat(turns: readonly StoredTurn[]): void {
  Storage.setItemSync(KEY, JSON.stringify(turns.slice(-KEEP)));
}

export function clearChat(): void {
  Storage.removeItemSync(KEY);
}

/** The turns as the engines take them: role and text only, nothing else leaves the phone. */
export const chatLines = (turns: readonly StoredTurn[]): ChatTurn[] => turns.map(({ role, content }) => ({ role, content }));

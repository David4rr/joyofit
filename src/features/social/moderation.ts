import Storage from 'expo-sqlite/kv-store';
import { useSyncExternalStore } from 'react';

import { addHidden, parseReported, removeHidden, serializeReported, type HideKind, type Hidden } from '@/features/social/moderationCore';

const KEY = 'joyofit.social.reported';

let state: Hidden = parseReported(Storage.getItemSync(KEY));
const listeners = new Set<() => void>();

function set(next: Hidden): void {
  if (next === state) return;
  const reportedChanged =
    next.reportedPosts !== state.reportedPosts || next.reportedComments !== state.reportedComments || next.reportedUsers !== state.reportedUsers;
  state = next;
  if (reportedChanged) Storage.setItemSync(KEY, serializeReported(state));
  for (const listener of listeners) listener();
}

/** Hides `id` for this phone from now on: a blocked or reported person, or a reported post or comment. */
export function hide(kind: HideKind, id: string): void {
  set(addHidden(state, kind, id));
}

/** Shows a person again (after unblocking). */
export function unhide(kind: HideKind, id: string): void {
  set(removeHidden(state, kind, id));
}

/** Replaces the blocked people with what JoyoRogo's block list says. */
export function setBlocked(userIds: readonly string[]): void {
  const same = userIds.length === state.blockedUsers.length && userIds.every((id) => state.blockedUsers.includes(id));
  if (!same) set({ ...state, blockedUsers: [...userIds] });
}

/** What is hidden on this phone; re-renders when it changes. */
export function useHidden(): Hidden {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
  );
}

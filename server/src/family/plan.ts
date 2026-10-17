import type { LinkRow } from "./store";

/** Free watches one person, Pro up to five; any parent can have up to five watchers (the parent is never gated). */
export const MAX_WATCHING_FREE = 1;
export const MAX_WATCHING_PRO = 5;
export const MAX_WATCHERS = 5;

export const maxWatching = (pro: boolean) => (pro ? MAX_WATCHING_PRO : MAX_WATCHING_FREE);

/**
 * Links a watcher can no longer use because their plan lapsed: the oldest ones stay live up to the Free limit, the
 * rest freeze (nothing is deleted, they come back when Pro does). Pass every link of the watcher.
 */
export function frozenLinkIds(watcherLinks: LinkRow[], pro: boolean): Set<string> {
  if (pro) return new Set();
  const ordered = [...watcherLinks].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  return new Set(ordered.slice(MAX_WATCHING_FREE).map((l) => l.id));
}

import type { RogoPost } from '@/cloud/rogo';
import type { Thread } from '@/features/social/commentThreads';

/**
 * What the signed-in person hid on this phone. `blockedUsers` mirrors the accounts they blocked (JoyoRogo already
 * filters them out of every read; this hides them at once, before the next read). The reported sets are kept only here:
 * a report hides the content for its reporter while the admins review it.
 */
export interface Hidden {
  blockedUsers: readonly string[];
  reportedPosts: readonly string[];
  reportedComments: readonly string[];
  reportedUsers: readonly string[];
}

export const NOTHING_HIDDEN: Hidden = { blockedUsers: [], reportedPosts: [], reportedComments: [], reportedUsers: [] };

/** Each reported list keeps the newest this many ids; older reports are long reviewed. */
export const KEEP_REPORTED = 500;

/** What `hide` adds, one kind at a time. */
export type HideKind = keyof Hidden;

export function addHidden(hidden: Hidden, kind: HideKind, id: string): Hidden {
  const list = hidden[kind];
  if (list.includes(id)) return hidden;
  return { ...hidden, [kind]: [...list, id].slice(-KEEP_REPORTED) };
}

export function removeHidden(hidden: Hidden, kind: HideKind, id: string): Hidden {
  const list = hidden[kind];
  return list.includes(id) ? { ...hidden, [kind]: list.filter((x) => x !== id) } : hidden;
}

/** Reads the stored form; anything unreadable is nothing hidden. Blocked users are not stored, the server owns them. */
export function parseReported(raw: string | null): Hidden {
  if (raw === null) return NOTHING_HIDDEN;
  try {
    const value = JSON.parse(raw) as Partial<Record<HideKind, unknown>> | null;
    const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(-KEEP_REPORTED) : []);
    return {
      blockedUsers: [],
      reportedPosts: ids(value?.reportedPosts),
      reportedComments: ids(value?.reportedComments),
      reportedUsers: ids(value?.reportedUsers),
    };
  } catch {
    return NOTHING_HIDDEN;
  }
}

export function serializeReported(hidden: Hidden): string {
  return JSON.stringify({ reportedPosts: hidden.reportedPosts, reportedComments: hidden.reportedComments, reportedUsers: hidden.reportedUsers });
}

/** A person whose content is hidden: blocked, or reported as a profile. */
export function userHidden(hidden: Hidden, userId: string): boolean {
  return hidden.blockedUsers.includes(userId) || hidden.reportedUsers.includes(userId);
}

export function postHidden(hidden: Hidden, post: Pick<RogoPost, 'id' | 'author'>): boolean {
  return hidden.reportedPosts.includes(post.id) || userHidden(hidden, post.author.id);
}

export function visiblePosts(hidden: Hidden, posts: readonly RogoPost[]): RogoPost[] {
  return posts.filter((p) => !postHidden(hidden, p));
}

/**
 * The threads as the person should see them. A blocked or reported author's comments go, a blocked author's thread with
 * them. A reported top-level comment that has replies stays as `placeholder` so the replies keep their place.
 */
export function visibleThreads(hidden: Hidden, threads: readonly Thread[]): { thread: Thread; placeholder: boolean; hiddenReplies: number }[] {
  const out: { thread: Thread; placeholder: boolean; hiddenReplies: number }[] = [];
  for (const thread of threads) {
    const { comment } = thread;
    if (!comment.deleted && userHidden(hidden, comment.author.id)) continue;
    const replies = thread.replies.filter((r) => r.deleted || (!hidden.reportedComments.includes(r.id) && !userHidden(hidden, r.author.id)));
    const reported = !comment.deleted && hidden.reportedComments.includes(comment.id);
    if (reported && comment.replyCount === 0 && replies.length === 0) continue;
    out.push({ thread: replies.length === thread.replies.length ? thread : { ...thread, replies }, placeholder: reported, hiddenReplies: thread.replies.length - replies.length });
  }
  return out;
}

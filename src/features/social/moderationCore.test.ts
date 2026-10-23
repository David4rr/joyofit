import { describe, expect, it } from 'bun:test';

import type { RogoComment, RogoPost } from '@/cloud/rogo';
import type { Thread } from './commentThreads';
import { NOTHING_HIDDEN, addHidden, parseReported, postHidden, removeHidden, serializeReported, visiblePosts, visibleThreads } from './moderationCore';

const author = (id: string) => ({ id, name: id, handle: id, image: null });
const post = (id: string, by: string) => ({ id, author: author(by) }) as RogoPost;
const comment = (id: string, by: string, extra: Partial<RogoComment> = {}) =>
  ({ id, body: id, author: author(by), deleted: false, parentId: null, replyCount: 0, replyTo: null, attachment: null, createdAt: '', ...extra }) as RogoComment;
const thread = (c: RogoComment, replies: RogoComment[] = []): Thread => ({ comment: c, replies, repliesCursor: null, repliesRead: true, open: true });

describe('posts', () => {
  it('hides a blocked author, a reported profile and a reported post', () => {
    let h = addHidden(NOTHING_HIDDEN, 'blockedUsers', 'bad');
    h = addHidden(h, 'reportedUsers', 'meh');
    h = addHidden(h, 'reportedPosts', 'p3');
    const posts = [post('p1', 'ok'), post('p2', 'bad'), post('p3', 'ok'), post('p4', 'meh')];
    expect(visiblePosts(h, posts).map((p) => p.id)).toEqual(['p1']);
    expect(postHidden(NOTHING_HIDDEN, posts[1]!)).toBe(false);
  });

  it('shows the author again after unblocking', () => {
    const h = removeHidden(addHidden(NOTHING_HIDDEN, 'blockedUsers', 'bad'), 'blockedUsers', 'bad');
    expect(visiblePosts(h, [post('p', 'bad')])).toHaveLength(1);
  });
});

describe('comment threads', () => {
  it('drops a blocked author with the whole thread and a blocked reply', () => {
    const h = addHidden(NOTHING_HIDDEN, 'blockedUsers', 'bad');
    const shown = visibleThreads(h, [thread(comment('a', 'bad', { replyCount: 1 }), [comment('a1', 'ok')]), thread(comment('b', 'ok', { replyCount: 2 }), [comment('b1', 'bad'), comment('b2', 'ok')])]);
    expect(shown.map((s) => s.thread.comment.id)).toEqual(['b']);
    expect(shown[0]!.thread.replies.map((r) => r.id)).toEqual(['b2']);
    expect(shown[0]!.hiddenReplies).toBe(1);
  });

  it('removes a reported comment, but keeps a reported parent as a placeholder while it has replies', () => {
    const h = addHidden(addHidden(NOTHING_HIDDEN, 'reportedComments', 'a'), 'reportedComments', 'c');
    const shown = visibleThreads(h, [thread(comment('a', 'ok', { replyCount: 1 }), [comment('a1', 'ok')]), thread(comment('c', 'ok'))]);
    expect(shown.map((s) => [s.thread.comment.id, s.placeholder])).toEqual([['a', true]]);
  });
});

describe('storage', () => {
  it('round-trips the reported ids and never stores blocked users', () => {
    const h = addHidden(addHidden(addHidden(NOTHING_HIDDEN, 'reportedPosts', 'p'), 'blockedUsers', 'u'), 'reportedUsers', 'r');
    expect(parseReported(serializeReported(h))).toEqual({ blockedUsers: [], reportedPosts: ['p'], reportedComments: [], reportedUsers: ['r'] });
  });

  it('treats junk as nothing hidden and caps the list', () => {
    expect(parseReported('{')).toBe(NOTHING_HIDDEN);
    expect(parseReported(null)).toBe(NOTHING_HIDDEN);
    expect(parseReported('{"reportedPosts":[1,"x"]}').reportedPosts).toEqual(['x']);
    let h = NOTHING_HIDDEN;
    for (let i = 0; i < 520; i++) h = addHidden(h, 'reportedPosts', `p${i}`);
    expect(h.reportedPosts).toHaveLength(500);
    expect(h.reportedPosts.at(-1)).toBe('p519');
  });
});

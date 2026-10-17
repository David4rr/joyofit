import { describe, expect, test } from 'bun:test';

import { normalizeInviteCode, previewLine } from '@/features/family/invite';

describe('normalizeInviteCode', () => {
  test('upper-cases and drops separators and spaces', () => {
    expect(normalizeInviteCode('abcd 2345')).toBe('ABCD2345');
    expect(normalizeInviteCode(' ABCD-2345\n')).toBe('ABCD2345');
  });

  test('stops at eight characters', () => {
    expect(normalizeInviteCode('abcdefghijkl')).toBe('ABCDEFGH');
  });

  test('a pasted invite link gives its code', () => {
    expect(normalizeInviteCode('https://fit.joyorogo.com/keluarga/abcd2345')).toBe('ABCD2345');
  });
});

describe('previewLine', () => {
  test('a watcher asks to see the acceptor, a monitored person offers to be seen', () => {
    expect(previewLine({ inviterName: 'Dina', inviterRole: 'watcher' })).toBe('Dina ingin ikut memantau kabarmu dari jam Huawei-mu.');
    expect(previewLine({ inviterName: 'Ibu Rina', inviterRole: 'monitored' })).toBe('Ibu Rina mengundangmu memantau kabarnya dari jam Huawei-nya.');
  });
});

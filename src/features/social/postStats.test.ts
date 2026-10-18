import { describe, expect, test } from 'bun:test';

import type { RogoPost } from '@/cloud/rogo';
import { applyLocale } from '@/i18n';
import { postFigures } from './postStats';

const post = { durationMin: 42, kcal: 1234, createdAt: '2026-01-01T00:00:00Z', stats: null } as unknown as RogoPost;

describe('postFigures', () => {
  test('labels and values follow the language', async () => {
    expect(postFigures(post)).toEqual([
      { label: 'Waktu', value: '42 mnt' },
      { label: 'Energi', value: '1.234 kcal' },
    ]);
    await applyLocale('en');
    try {
      expect(postFigures(post)).toEqual([
        { label: 'Time', value: '42 min' },
        { label: 'Energy', value: '1,234 kcal' },
      ]);
    } finally {
      await applyLocale('id');
    }
  });
});

import { afterEach, describe, expect, it } from 'bun:test';

import { applyLocale } from '@/i18n';

import { blockLabel, buildCourse, formatMetres, formatSeconds, newBlock, newStep, type CourseDraft } from './courseModel';

afterEach(() => applyLocale('id'));

describe('course text', () => {
  const group: CourseDraft = { name: 'x', blocks: [newBlock([newStep()]), newBlock([newStep(), newStep()], 2)] };

  it('labels plain steps and groups in the active language', async () => {
    expect([blockLabel(group, 0), blockLabel(group, 1)]).toEqual(['Langkah 1', 'Grup 2']);
    await applyLocale('en');
    expect([blockLabel(group, 0), blockLabel(group, 1)]).toEqual(['Step 1', 'Group 2']);
  });

  it('words the first problem and says where it is', async () => {
    expect(buildCourse({ name: '', blocks: [] }).error).toBe('Beri nama pada program.');
    const bad: CourseDraft = { name: 'x', blocks: [newBlock([{ ...newStep(), seconds: '99' }])] };
    expect(buildCourse(bad).error).toBe('Langkah 1: Detik 0 sampai 59, menit berupa bilangan bulat.');
    await applyLocale('en');
    expect(buildCourse(bad).error).toBe('Step 1: Seconds are 0 to 59, minutes are whole numbers.');
  });

  it('formats durations and distances with the language units', async () => {
    expect(formatSeconds(3725)).toBe('1 j 2 mnt 5 dtk');
    expect(formatMetres(1500)).toBe('1,5 km');
    await applyLocale('en');
    expect(formatSeconds(3725)).toBe('1 h 2 min 5 s');
    expect(formatMetres(1500)).toBe('1.5 km');
  });
});

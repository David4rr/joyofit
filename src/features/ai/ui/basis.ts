import type { TFunction } from 'i18next';

import { daysBetween } from '@/features/coach/time';
import { DAILY_FIELDS, type DailyField, type ToolTrace } from '../tools';

type AiT = TFunction<'ai'>;

const isField = (v: string): v is DailyField => (DAILY_FIELDS as readonly string[]).includes(v);

/** Whole days of a `from`/`to` range from a trace, at least 1; 0 when the dates are not usable. */
function spanOf(args: ToolTrace['args']): number {
  const from = String(args.from ?? '');
  const to = String(args.to ?? '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return 0;
  return Math.abs(daysBetween(from, to)) + 1;
}

interface Tally {
  /** metric label -> longest span read, kept in the order first read. */
  spans: Map<string, { text: (days: number) => string; days: number }>;
  nights: number;
  workouts: number;
  plan: boolean;
  note: boolean;
}

const fieldLabel = (t: AiT, field: string): string => (isField(field) ? t(`basis.field.${field}`) : t('basis.field.all'));

function tally(trace: readonly ToolTrace[], t: AiT): Tally {
  const out: Tally = { spans: new Map(), nights: 0, workouts: 0, plan: false, note: false };
  const span = (id: string, days: number, text: (days: number) => string) => {
    const known = out.spans.get(id);
    if (!known) out.spans.set(id, { text, days });
    else known.days = Math.max(known.days, days);
  };
  const days = (n: number) => t('basis.days', { count: n });
  for (const entry of trace) {
    switch (entry.tool) {
      case 'get_daily': {
        const raw = String(entry.args.fields ?? 'all');
        const labels = raw === 'all' ? ['all'] : raw.split(',').filter(Boolean);
        const n = spanOf(entry.args);
        for (const field of labels) {
          const label = fieldLabel(t, field);
          span(`daily:${field}`, n, (d) => (d > 0 ? t('basis.metric', { what: label, days: days(d) }) : label));
        }
        break;
      }
      case 'get_trend': {
        const label = fieldLabel(t, String(entry.args.metric ?? ''));
        span(`trend:${String(entry.args.metric)}`, Number(entry.args.days) || 0, (d) => (d > 0 ? t('basis.trend', { what: label, days: days(d) }) : label));
        break;
      }
      case 'get_nutrition':
        span('food', spanOf(entry.args), (d) => (d > 0 ? t('basis.metric', { what: t('basis.food'), days: days(d) }) : t('basis.food')));
        break;
      case 'list_workouts':
        span('list', spanOf(entry.args), (d) => (d > 0 ? t('basis.metric', { what: t('basis.workoutList'), days: days(d) }) : t('basis.workoutList')));
        break;
      case 'get_sleep_night':
        out.nights += 1;
        break;
      case 'get_workout':
        out.workouts += 1;
        break;
      case 'get_plan':
        out.plan = true;
        break;
      case 'propose_note':
        out.note = true;
        break;
    }
  }
  return out;
}

/**
 * What an answer read, in plain words and without any health value (sleep with its days, HRV with its days, a workout count). The
 * same thing read twice is said once, with the longest range.
 */
export function basisPhrases(trace: readonly ToolTrace[], t: AiT, opts: { notes?: boolean } = {}): string[] {
  const tl = tally(trace, t);
  const phrases = [...tl.spans.values()].map((s) => s.text(s.days));
  if (tl.nights > 0) phrases.push(t('basis.nights', { count: tl.nights }));
  if (tl.workouts > 0) phrases.push(t('basis.workouts', { count: tl.workouts }));
  if (tl.plan) phrases.push(t('basis.plan'));
  if (tl.note && opts.notes) phrases.push(t('basis.noteProposed'));
  return phrases;
}

/** "Dasar jawaban: ringkasan 14 hari, tidur 7 hari, 3 latihan". The digest is always part of an own-key answer. */
export function basisLine(trace: readonly ToolTrace[], t: AiT): string {
  return t('basis.summary', { items: [t('basis.digest'), ...basisPhrases(trace, t)].join(', ') });
}

/** One call as the person can check it: its plain words and the exact tool and arguments (dates and field names, never values). */
export function describeCall(entry: ToolTrace, t: AiT): { words: string; call: string } {
  const args = Object.entries(entry.args)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(', ');
  const words = basisPhrases([entry], t, { notes: true }).join(', ') || t('basis.field.all');
  return { words, call: `${entry.tool}(${args})` };
}

/** The status line while the model works. */
export function workingText(status: { kind: 'thinking' } | { kind: 'tool'; trace: ToolTrace }, t: AiT): string {
  if (status.kind === 'thinking') return t('working.thinking');
  if (status.trace.tool === 'propose_note') return t('working.note');
  const what = basisPhrases([status.trace], t).join(', ');
  return what ? t('working.reading', { what }) : t('working.thinking');
}

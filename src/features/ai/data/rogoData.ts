import { NotSignedInError } from '@/cloud/api';
import { rogo } from '@/cloud/rogo';
import { addDays } from '@/features/coach/time';
import type { NutritionDay } from '../tools';

const CACHE_MS = 2 * 60_000;
const POOL = 4;

/**
 * The JoyoRogo reads the tools use: `food/listByDate` per day and `weight/history`, the same calls Meals on the watch already makes.
 * Nothing is written. Answers are kept for two minutes so a tool loop that asks twice does not call twice. When the person is signed
 * out (no session cookie) the answer is `not_connected`, never a guess.
 */
export function createRogoData(now: () => number = Date.now) {
  const foodCache = new Map<string, { at: number; day: NutritionDay }>();
  let weights: { at: number; map: Map<string, number> } | null = null;

  const foodDay = async (d: string): Promise<NutritionDay> => {
    const hit = foodCache.get(d);
    if (hit && now() - hit.at < CACHE_MS) return hit.day;
    const { items, totals } = await rogo.foodDay(d);
    const day: NutritionDay = {
      d,
      kcal: Math.round(totals.kcal),
      proteinG: Math.round(totals.protein),
      carbsG: Math.round(totals.carbs),
      fatG: Math.round(totals.fat),
      meals: new Set(items.map((i) => i.meal)).size,
      logged: items.length > 0,
    };
    foodCache.set(d, { at: now(), day });
    return day;
  };

  return {
    async food(from: string, to: string): Promise<NutritionDay[] | 'not_connected'> {
      const dates: string[] = [];
      for (let d = from; d <= to && dates.length < 14; d = addDays(d, 1)) dates.push(d);
      const out: NutritionDay[] = [];
      try {
        for (let i = 0; i < dates.length; i += POOL) out.push(...(await Promise.all(dates.slice(i, i + POOL).map(foodDay))));
      } catch (error) {
        if (error instanceof NotSignedInError) return 'not_connected';
        throw error;
      }
      return out;
    },
    async weights(from: string, to: string): Promise<Map<string, number> | 'not_connected'> {
      try {
        if (!weights || now() - weights.at >= CACHE_MS) {
          const { entries } = await rogo.weightHistory(120);
          weights = { at: now(), map: new Map(entries.map((e) => [e.date, e.weightKg])) };
        }
      } catch (error) {
        if (error instanceof NotSignedInError) return 'not_connected';
        throw error;
      }
      return new Map([...weights.map].filter(([d]) => d >= from && d <= to));
    },
  };
}

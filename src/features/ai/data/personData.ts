import { rogo, type RogoMyProfile } from '@/cloud/rogo';
import { HuaweiWear } from '@/wear';
import { NotSignedInError } from '@/cloud/api';
import type { KvStore } from '../kv';
import { readJson } from '../kv';
import { ageFromBirthYear, EMPTY_PERSON, lowestAge, type Maternal, type Person } from '../person';

const KEY = 'joyofit.ai.person';

/** What the last JoyoRogo profile read said; kept so the age gate and the maternal block still work offline. Cleared on sign-out. */
interface CachedProfile {
  birthYear: number | null;
  maternal: Maternal;
  goal: Person['goal'];
  weightGoalKg: number | null;
  weightGoalDate: string | null;
  eatKcal: number | null;
  sex: Person['sex'];
  heightCm: number | null;
}

const valid = (v: unknown): v is CachedProfile => typeof v === 'object' && v !== null && 'maternal' in v;

function fromRogo(p: RogoMyProfile): CachedProfile {
  const row = p.profile;
  const sex = row?.gender === 'male' ? 'm' : row?.gender === 'female' ? 'f' : null;
  const eat = p.targets?.eatKcal;
  return {
    birthYear: typeof row?.birthYear === 'number' ? row.birthYear : null,
    maternal: row?.maternalMode === 'pregnant' || row?.maternalMode === 'breastfeeding' ? row.maternalMode : 'none',
    goal: row?.goal ?? null,
    weightGoalKg: typeof row?.targetWeightKg === 'number' ? row.targetWeightKg : null,
    weightGoalDate: typeof row?.targetDate === 'string' ? row.targetDate : null,
    eatKcal: typeof eat === 'number' && Number.isFinite(eat) ? Math.round(eat) : null,
    sex,
    heightCm: typeof row?.heightCm === 'number' ? row.heightCm : null,
  };
}

/**
 * Who is asking: height, sex and birth year from Settings, Profile on the phone (works signed out), and from the JoyoRogo profile
 * when signed in: goal, targets and the Hamil / Menyusui mode that switch the safety blocks on. The age is the lowest the two
 * sources give, so one of them saying under 18 keeps the own-key chat off.
 */
export async function readPerson(kv: KvStore, signedIn: boolean, nowYear: number = new Date().getFullYear()): Promise<Person> {
  const local = HuaweiWear.getUserProfile();
  let cached: CachedProfile | null = signedIn ? readJson<CachedProfile | null>(kv, KEY, null, (v): v is CachedProfile | null => v === null || valid(v)) : null;
  if (!signedIn) kv.removeItem(KEY);
  if (signedIn) {
    try {
      cached = fromRogo(await rogo.myProfile());
      kv.setItem(KEY, JSON.stringify(cached));
    } catch (error) {
      // Offline or a server error: the last answer stays in use. A person who is no longer signed in has none.
      if (error instanceof NotSignedInError) cached = null;
    }
  }
  const localSex = local?.sex === 'male' ? 'm' : local?.sex === 'female' ? 'f' : null;
  const localHeight = local && local.heightCm > 50 && local.heightCm < 260 ? local.heightCm : null;
  return {
    ...EMPTY_PERSON,
    ageYears: lowestAge(ageFromBirthYear(local?.birthYear, nowYear), ageFromBirthYear(cached?.birthYear, nowYear)),
    sex: cached?.sex ?? localSex,
    heightCm: localHeight ?? cached?.heightCm ?? null,
    goal: cached?.goal ?? null,
    maternal: cached?.maternal ?? 'none',
    weightGoalKg: cached?.weightGoalKg ?? null,
    weightGoalDate: cached?.weightGoalDate ?? null,
    eatKcal: cached?.eatKcal ?? null,
  };
}

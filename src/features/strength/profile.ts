import { HuaweiWear } from '@/wear';

/** Weight used when the person has not entered one in Settings > Profile (the same default the profile form starts with). */
export const DEFAULT_WEIGHT_KG = 70;

/** The person's weight in kg (Settings > Profile), for the energy estimate. */
export function userWeightKg(): number {
  const weight = HuaweiWear.getUserProfile()?.weightKg;
  return typeof weight === 'number' && weight >= 20 && weight <= 300 ? weight : DEFAULT_WEIGHT_KG;
}

import { HuaweiWear } from '@/wear';

/** Weight used when the person has not entered one in Settings > Profile (the same default the profile form starts with). */
export const DEFAULT_WEIGHT_KG = 70;

function savedWeightKg(): number | null {
  const weight = HuaweiWear.getUserProfile()?.weightKg;
  return typeof weight === 'number' && weight >= 20 && weight <= 300 ? weight : null;
}

/** The person's weight in kg (Settings > Profile), for the energy estimate. */
export function userWeightKg(): number {
  return savedWeightKg() ?? DEFAULT_WEIGHT_KG;
}

/** Whether the weight above is the person's own; false means the estimate ran on the default and the summary says so. */
export function hasUserWeight(): boolean {
  return savedWeightKg() !== null;
}

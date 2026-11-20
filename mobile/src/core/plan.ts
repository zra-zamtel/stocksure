/**
 * Subscription plans. For now nothing is ever charged: choosing a plan starts
 * a free trial that is only recorded on this phone, and skipping keeps the
 * shop on the free tier. When billing exists, it plugs in here.
 */
export type PlanId = 'standard' | 'pro';

export const PLANS: { id: PlanId; monthlyPriceZmw: number }[] = [
  { id: 'standard', monthlyPriceZmw: 150 },
  { id: 'pro', monthlyPriceZmw: 350 },
];

export const TRIAL_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

export type PlanChoice =
  | { kind: 'free' }
  | { kind: 'trial'; plan: PlanId; startedAt: string };

/** Whole days of trial left, counting today; 0 once it has run out. */
export function trialDaysLeft(startedAt: string, now: Date = new Date()): number {
  const start = Date.parse(startedAt);
  if (Number.isNaN(start)) return 0;
  const elapsed = Math.floor((now.getTime() - start) / DAY_MS);
  return Math.max(0, Math.min(TRIAL_DAYS, TRIAL_DAYS - elapsed));
}

/** Reads a stored choice defensively: anything unrecognised counts as free. */
export function parsePlanChoice(raw: string | null | undefined): PlanChoice {
  if (!raw) return { kind: 'free' };
  try {
    const value = JSON.parse(raw) as Partial<{ kind: string; plan: string; startedAt: string }>;
    if (
      value.kind === 'trial' &&
      (value.plan === 'standard' || value.plan === 'pro') &&
      typeof value.startedAt === 'string' &&
      !Number.isNaN(Date.parse(value.startedAt))
    ) {
      return { kind: 'trial', plan: value.plan, startedAt: value.startedAt };
    }
  } catch {
    // Fall through to free.
  }
  return { kind: 'free' };
}

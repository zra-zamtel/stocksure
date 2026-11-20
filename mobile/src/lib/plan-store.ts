import Storage from 'expo-sqlite/kv-store';
import { parsePlanChoice, type PlanChoice, type PlanId } from '@/core';

// The plan lives on this phone only. No payment is taken anywhere.
const PLAN_KEY = 'stocksure.plan';

export function readPlanChoice(): PlanChoice {
  try {
    return parsePlanChoice(Storage.getItemSync(PLAN_KEY));
  } catch {
    return { kind: 'free' };
  }
}

export function startTrial(plan: PlanId, now: Date = new Date()): PlanChoice {
  const choice: PlanChoice = { kind: 'trial', plan, startedAt: now.toISOString() };
  Storage.setItemSync(PLAN_KEY, JSON.stringify(choice));
  return choice;
}

export function continueFree(): PlanChoice {
  const choice: PlanChoice = { kind: 'free' };
  Storage.setItemSync(PLAN_KEY, JSON.stringify(choice));
  return choice;
}

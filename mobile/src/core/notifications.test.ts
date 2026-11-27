import { describe, expect, it } from 'vitest';
import {
  forgetRestocked,
  lowStockMessage,
  planLowStock,
  taxReminderMessage,
  taxReminderSlots,
  type LowStockItem,
  type Translate,
} from './notifications';

// Echoes the key and its variables, so tests check which copy was chosen
// without depending on the English wording.
const t: Translate = (key, vars) =>
  vars ? `${key}(${Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(',')})` : key;

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);

describe('taxReminderSlots', () => {
  const days = [7, 3, 0];

  it('schedules each reminder at 09:00 local, earliest first', () => {
    const slots = taxReminderSlots({ dueOn: '2026-12-14', daysBefore: days, now: local(2026, 11, 27), short: true });
    expect(slots.map((slot) => [slot.daysBefore, slot.kind])).toEqual([
      [7, 'open'],
      [3, 'soon'],
      [0, 'due'],
    ]);
    expect(slots[0].at).toEqual(local(2026, 12, 7, 9));
    expect(slots[1].at).toEqual(local(2026, 12, 11, 9));
    expect(slots[2].at).toEqual(local(2026, 12, 14, 9));
    expect(slots.every((slot) => slot.at.getHours() === 9 && slot.at.getMinutes() === 0)).toBe(true);
  });

  it('skips the due-day reminder when the pot covers the tax', () => {
    const slots = taxReminderSlots({ dueOn: '2026-12-14', daysBefore: days, now: local(2026, 11, 27), short: false });
    expect(slots.map((slot) => slot.daysBefore)).toEqual([7, 3]);
  });

  it('keeps future slots only', () => {
    // 09:00 on the 11th has passed by 09:30.
    const slots = taxReminderSlots({ dueOn: '2026-12-14', daysBefore: days, now: local(2026, 12, 11, 9, 30), short: true });
    expect(slots.map((slot) => slot.daysBefore)).toEqual([0]);
    // Just before 09:00 the same day still counts.
    const early = taxReminderSlots({ dueOn: '2026-12-14', daysBefore: days, now: local(2026, 12, 11, 8, 59), short: true });
    expect(early.map((slot) => slot.daysBefore)).toEqual([3, 0]);
    expect(taxReminderSlots({ dueOn: '2026-12-14', daysBefore: days, now: local(2026, 12, 15), short: true })).toEqual([]);
  });

  it('crosses month and year ends', () => {
    const slots = taxReminderSlots({ dueOn: '2027-01-03', daysBefore: [7], now: local(2026, 12, 1), short: false });
    expect(slots[0].at).toEqual(local(2026, 12, 27, 9));
  });

  it('ignores negative and repeated days and gives stable ids', () => {
    const slots = taxReminderSlots({ dueOn: '2026-12-14', daysBefore: [3, -2, 3, 7], now: local(2026, 11, 1), short: false });
    expect(slots.map((slot) => slot.id)).toEqual(['tax-2026-12-14-7', 'tax-2026-12-14-3']);
  });

  it('returns nothing for a bad date', () => {
    expect(taxReminderSlots({ dueOn: 'soon', daysBefore: days, now: local(2026, 11, 1), short: true })).toEqual([]);
  });
});

const item = (variantId: string, quantity = 1, label = variantId): LowStockItem => ({
  variantId,
  productId: `p-${variantId}`,
  label,
  quantity,
});

describe('planLowStock', () => {
  it('announces a variant once while it stays low', () => {
    const first = planLowStock([], [item('a')]);
    expect(first.fresh.map((row) => row.variantId)).toEqual(['a']);
    const again = planLowStock(first.notifiedIfSent, [item('a', 0)]);
    expect(again.fresh).toEqual([]);
    expect(again.notifiedIfSent).toEqual(['a']);
  });

  it('announces again after a restock and a new drop', () => {
    const told = planLowStock([], [item('a')]).notifiedIfSent;
    // Restocked above its level: no longer in the low list.
    const restocked = forgetRestocked(told, []);
    expect(restocked).toEqual([]);
    expect(planLowStock(restocked, [item('a')]).fresh).toHaveLength(1);
  });

  it('forgets restocked variants on an ordinary check too', () => {
    const plan = planLowStock(['a', 'b'], [item('b'), item('c')]);
    expect(plan.fresh.map((row) => row.variantId)).toEqual(['c']);
    expect(plan.notifiedIfSent).toEqual(['b', 'c']);
    expect(plan.notifiedIfSkipped).toEqual(['b']);
  });

  it('keeps a variant that is restocked but still low', () => {
    expect(forgetRestocked(['a'], ['a'])).toEqual(['a']);
  });
});

describe('lowStockMessage', () => {
  it('names one item and links to it', () => {
    expect(lowStockMessage([item('a', 2, 'Black school shoes (size 40)')], t)).toEqual({
      title: 'notify.stock.oneTitle(name=Black school shoes (size 40))',
      body: 'notify.stock.left(count=2)',
      url: '/product/p-a',
    });
    expect(lowStockMessage([item('a', 0)], t)).toMatchObject({
      title: 'notify.stock.oneOutTitle(name=a)',
      body: 'notify.stock.out',
    });
  });

  it('lists two or three items in one notification', () => {
    const message = lowStockMessage([item('a', 1), item('b', 0), item('c', 3)], t);
    expect(message?.title).toBe('notify.stock.manyTitle(count=3)');
    expect(message?.body.split('\n')).toEqual([
      'a: notify.stock.left(count=1)',
      'b: notify.stock.out',
      'c: notify.stock.left(count=3)',
    ]);
    expect(message?.url).toBe('/(tabs)/products');
  });

  it('gives a count and the first names past three', () => {
    const message = lowStockMessage(['a', 'b', 'c', 'd', 'e'].map((id) => item(id)), t);
    expect(message?.title).toBe('notify.stock.manyTitle(count=5)');
    expect(message?.body).toBe('notify.stock.manyBody(names=a, b, c,more=2)');
  });

  it('says nothing for an empty list', () => {
    expect(lowStockMessage([], t)).toBeNull();
  });
});

describe('taxReminderMessage', () => {
  const facts = { dueDay: '14 Dec', estimate: 'K50', pot: 'K20', shortBy: 'K30', short: true, incomeTax: false };

  it('opens the window, gives the figures and the shortfall', () => {
    const message = taxReminderMessage({ kind: 'open', daysBefore: 7 }, facts, t);
    expect(message.title).toBe('notify.tax.openTitle');
    expect(message.body).toBe(
      'notify.tax.openBody(date=14 Dec) notify.tax.figures(estimate=K50,pot=K20) notify.tax.short(amount=K30)'
    );
    expect(message.url).toBe('/(tabs)/tax');
  });

  it('counts down and leaves out the shortfall when covered', () => {
    const message = taxReminderMessage({ kind: 'soon', daysBefore: 3 }, { ...facts, short: false }, t);
    expect(message.title).toBe('notify.tax.soonTitle(days=3)');
    expect(message.body).toBe('notify.tax.figures(estimate=K50,pot=K20)');
  });

  it('sends income tax shops to ZRA instead of an estimate', () => {
    const message = taxReminderMessage({ kind: 'due', daysBefore: 0 }, { ...facts, incomeTax: true }, t);
    expect(message.title).toBe('notify.tax.dueTitle');
    expect(message.body).toBe('notify.tax.incomeTax(pot=K20)');
  });
});

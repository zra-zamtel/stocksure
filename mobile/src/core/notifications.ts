/**
 * Phone notifications, the parts that are pure decisions: which tax reminders
 * to schedule, which low-stock items are new, and the words to show. The
 * native calls live in src/notifications; this file has no Expo in it so it
 * can be tested in plain Node.
 */

/** Reminders go off at this local hour. Best effort: Android may deliver a little late. */
export const REMINDER_HOUR = 9;

export type TaxReminderKind = 'open' | 'soon' | 'due';

export interface TaxReminderSlot {
  daysBefore: number;
  /** Local time the reminder should fire. */
  at: Date;
  kind: TaxReminderKind;
  /** Stable per due date and slot, so rescheduling replaces rather than duplicates. */
  id: string;
}

export const TAX_REMINDER_PREFIX = 'tax-';

/**
 * The reminders still worth scheduling for one due date. Each fires at 09:00
 * local on its day; slots already past are dropped. The earliest reminder says
 * the filing window is open. The due-day reminder only goes out when the
 * TaxPot is short: on the day itself there is nothing to say otherwise.
 */
export function taxReminderSlots(input: {
  dueOn: string;
  daysBefore: readonly number[];
  now: Date;
  short: boolean;
  hour?: number;
}): TaxReminderSlot[] {
  const [year, month, day] = input.dueOn.split('-').map(Number);
  if (!year || !month || !day) return [];
  const hour = input.hour ?? REMINDER_HOUR;
  const days = [...new Set(input.daysBefore.filter((value) => Number.isInteger(value) && value >= 0))].sort(
    (a, b) => b - a
  );
  const earliest = days.find((value) => value > 0);

  return days
    .filter((daysBefore) => daysBefore > 0 || input.short)
    .map((daysBefore) => ({
      daysBefore,
      // The Date constructor rolls day 0 or negative days back into the previous month.
      at: new Date(year, month - 1, day - daysBefore, hour, 0, 0, 0),
      kind: (daysBefore === 0 ? 'due' : daysBefore === earliest ? 'open' : 'soon') as TaxReminderKind,
      id: `${TAX_REMINDER_PREFIX}${input.dueOn}-${daysBefore}`,
    }))
    .filter((slot) => slot.at.getTime() > input.now.getTime())
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

export interface LowStockItem {
  variantId: string;
  productId: string;
  label: string;
  quantity: number;
}

export interface LowStockPlan<T extends LowStockItem = LowStockItem> {
  /** Low now and not told about since they were last restocked. */
  fresh: T[];
  /** What to remember as already told, if the fresh ones are sent. */
  notifiedIfSent: string[];
  /** What to remember if nothing is sent (permission off, toggle off). */
  notifiedIfSkipped: string[];
}

/**
 * A variant is announced once when it drops to its low level. It is forgotten
 * (so it can be announced again) only once it is no longer low, which means a
 * restock took it above its level. Anything not low any more is dropped from
 * the remembered list on every check, whatever caused it.
 */
export function planLowStock<T extends LowStockItem>(
  notified: readonly string[],
  lowNow: readonly T[]
): LowStockPlan<T> {
  const lowIds = new Set(lowNow.map((item) => item.variantId));
  const stillLow = notified.filter((id) => lowIds.has(id));
  const told = new Set(stillLow);
  const fresh = lowNow.filter((item) => !told.has(item.variantId));
  return {
    fresh,
    notifiedIfSent: [...stillLow, ...fresh.map((item) => item.variantId)],
    notifiedIfSkipped: stillLow,
  };
}

/** After a restock: forget whatever is no longer low, announce nothing. */
export function forgetRestocked(notified: readonly string[], lowNowIds: readonly string[]): string[] {
  const lowIds = new Set(lowNowIds);
  return notified.filter((id) => lowIds.has(id));
}

export type Translate = (key: string, vars?: Record<string, string | number>) => string;

export interface NotificationMessage {
  title: string;
  body: string;
  /** Where a tap takes the owner. */
  url: string;
}

const NAMES_SHOWN = 3;

function stockWord(item: LowStockItem, t: Translate): string {
  return item.quantity <= 0 ? t('notify.stock.out') : t('notify.stock.left', { count: item.quantity });
}

/**
 * One item: named, with how many are left. Two or three: one notification
 * listing them. More: the count and the first few names.
 */
export function lowStockMessage(items: readonly LowStockItem[], t: Translate): NotificationMessage | null {
  if (items.length === 0) return null;
  if (items.length === 1) {
    const [item] = items;
    return {
      title: t(item.quantity <= 0 ? 'notify.stock.oneOutTitle' : 'notify.stock.oneTitle', { name: item.label }),
      body: stockWord(item, t),
      url: `/product/${item.productId}`,
    };
  }
  const title = t('notify.stock.manyTitle', { count: items.length });
  if (items.length <= NAMES_SHOWN) {
    return {
      title,
      body: items.map((item) => `${item.label}: ${stockWord(item, t)}`).join('\n'),
      url: '/(tabs)/products',
    };
  }
  return {
    title,
    body: t('notify.stock.manyBody', {
      names: items
        .slice(0, NAMES_SHOWN)
        .map((item) => item.label)
        .join(', '),
      more: items.length - NAMES_SHOWN,
    }),
    url: '/(tabs)/products',
  };
}

export interface TaxReminderFacts {
  dueDay: string;
  estimate: string;
  pot: string;
  /** Formatted shortfall; only read when `short`. */
  shortBy: string;
  short: boolean;
  incomeTax: boolean;
}

export function taxReminderMessage(
  slot: Pick<TaxReminderSlot, 'kind' | 'daysBefore'>,
  facts: TaxReminderFacts,
  t: Translate
): NotificationMessage {
  const title =
    slot.kind === 'open'
      ? t('notify.tax.openTitle')
      : slot.kind === 'due'
        ? t('notify.tax.dueTitle')
        : t('notify.tax.soonTitle', { days: slot.daysBefore });

  const parts: string[] = [];
  if (slot.kind === 'open') parts.push(t('notify.tax.openBody', { date: facts.dueDay }));
  if (facts.incomeTax) {
    // Above the turnover tax limit there is no fixed estimate to show.
    parts.push(t('notify.tax.incomeTax', { pot: facts.pot }));
  } else {
    parts.push(t('notify.tax.figures', { estimate: facts.estimate, pot: facts.pot }));
    if (facts.short) parts.push(t('notify.tax.short', { amount: facts.shortBy }));
  }
  return { title, body: parts.join(' '), url: '/(tabs)/tax' };
}

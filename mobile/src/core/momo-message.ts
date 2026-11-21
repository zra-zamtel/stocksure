import type { Ngwee, Provider } from './types';

/**
 * Reads a mobile money "you have received" message that the owner copied from
 * their SMS app and pasted into StockSure. Provider formats differ and change,
 * so this is deliberately forgiving: it finds what it can (amount, reference,
 * sender, time, provider) and reports what is missing, so the screen can ask
 * the owner for just that. Nothing here guesses an amount it cannot see.
 */

export interface ParsedMessage {
  provider?: Provider;
  amount?: Ngwee;
  reference?: string;
  sender?: string;
  /** ISO time printed in the message, if any; otherwise the caller uses "now". */
  receivedAt?: string;
  /** True when it looks like money sent out, not received. */
  outgoing: boolean;
}

const MONEY = String.raw`(?:ZMW|ZK|K)\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)`;

function toNgwee(text: string): Ngwee | undefined {
  const value = Number(text.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return undefined;
  return Math.round(value * 100);
}

function detectProvider(text: string): Provider | undefined {
  if (/\bairtel\b/i.test(text)) return 'Airtel';
  if (/\bzamtel\b|zamtel\s?kwacha|\bzamkwacha\b/i.test(text)) return 'Zamtel';
  if (/\bmtn\b|\bmomo\b|mobile money/i.test(text)) return 'MTN';
  return undefined;
}

function detectAmount(text: string): Ngwee | undefined {
  // Prefer the amount next to a "received" word, so a balance or a fee
  // mentioned later in the message is never taken for the payment.
  const near = new RegExp(
    String.raw`(?:received|receive|credited|deposit(?:ed)?|payment of|paid you|transferred)[^0-9]{0,40}?` + MONEY,
    'i'
  ).exec(text);
  if (near) return toNgwee(near[1]);

  const all = [...text.matchAll(new RegExp(MONEY, 'gi'))];
  for (const match of all) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 25), match.index).toLowerCase();
    if (/bal(ance)?|fee|charge|cost/.test(before)) continue;
    return toNgwee(match[1]);
  }
  return undefined;
}

function detectReference(text: string): string | undefined {
  const match =
    /(?:financial\s+transaction\s+id|transaction\s+id|trans(?:action)?\.?\s*id|txn\s*id|txn|ref(?:erence)?(?:\s*(?:no|number))?|tid)\s*[:#.\-]?\s*([A-Z0-9][A-Z0-9.\-]{4,})/i.exec(
      text
    );
  return match ? match[1].replace(/[.\-]+$/, '') : undefined;
}

function detectSender(text: string): string | undefined {
  const match =
    /\bfrom\s+(.+?)(?=\s+(?:on|at|ref|reference|trans|txn|tid|new|your|bal|id)\b|[.,;]\s|$)/i.exec(text);
  if (!match) return undefined;
  const sender = match[1].trim().replace(/[.,;]$/, '');
  return sender.length > 0 && sender.length <= 60 ? sender : undefined;
}

function detectTime(text: string): string | undefined {
  // 17/11/2026 09:16, 17-11-26 9:16, 2026-11-17 09:16:05
  const dmy = /\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  const ymd = /\b(\d{4})-(\d{1,2})-(\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(text);
  let parts: number[] | null = null;
  if (ymd) parts = [Number(ymd[1]), Number(ymd[2]), Number(ymd[3]), Number(ymd[4]), Number(ymd[5]), Number(ymd[6] ?? 0)];
  else if (dmy) {
    const year = Number(dmy[3]) < 100 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
    parts = [year, Number(dmy[2]), Number(dmy[1]), Number(dmy[4]), Number(dmy[5]), Number(dmy[6] ?? 0)];
  }
  if (!parts) return undefined;
  const [y, m, d, h, min, s] = parts;
  if (m < 1 || m > 12 || d < 1 || d > 31 || h > 23 || min > 59) return undefined;
  return new Date(y, m - 1, d, h, min, s).toISOString();
}

export function parsePaymentMessage(text: string): ParsedMessage {
  const clean = text.replace(/\s+/g, ' ').trim();
  return {
    provider: detectProvider(clean),
    amount: detectAmount(clean),
    reference: detectReference(clean),
    sender: detectSender(clean),
    receivedAt: detectTime(clean),
    outgoing: /\b(you have sent|you sent|sent to|paid to|withdraw|cash ?out)\b/i.test(clean),
  };
}

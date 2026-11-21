import type { Provider } from '@/core';

/**
 * A pay request to a customer's mobile money wallet, shaped like a gateway
 * collection (Lipila and similar): the shop sends amount + phone, the customer
 * approves on their own phone, and the gateway reports the outcome with a
 * transaction reference.
 *
 * THIS IS A SIMULATION. Nothing leaves the phone and no money moves. It exists
 * so the flow, the screens and the reconciliation can be built and demoed now.
 * A real gateway would be called from the backend (its API key must never be
 * in the app) and would replace `simulatedGateway` behind the same interface.
 *
 * Demo numbers: the last digit of the customer's phone picks the outcome.
 *   ...0  the customer declines
 *   ...8  not enough balance
 *   ...9  the customer never answers (times out)
 *   other digits: approved
 */

export type CollectionStatus = 'sending' | 'waiting' | 'approved' | 'declined' | 'insufficient' | 'timeout';
export type CollectionOutcome = Extract<CollectionStatus, 'approved' | 'declined' | 'insufficient' | 'timeout'>;

export type CollectionRequest = {
  /** Ngwee. */
  amount: number;
  provider: Provider;
  /** Local digits as typed, e.g. "0971234567" or "971234567". */
  phone: string;
};

export type CollectionResult = {
  status: CollectionOutcome;
  /** Set when approved: the reference the provider's message would carry. */
  reference?: string;
  /** The phone in 0XXXXXXXXX form. */
  phone: string;
};

export interface PaymentGateway {
  readonly simulated: boolean;
  collect(
    request: CollectionRequest,
    options: { onStatus?: (status: CollectionStatus) => void; signal?: AbortSignal },
  ): Promise<CollectionResult>;
}

/** Network prefixes after the leading 0 (e.g. 097...). */
const PREFIXES: Record<Provider, string[]> = {
  MTN: ['96', '76'],
  Airtel: ['97', '77', '57'],
  Zamtel: ['95', '75'],
};

/** "097 123 4567", "+260971234567" or "971234567" → "0971234567"; null if it is not a Zambian mobile number. */
export function normaliseMobile(input: string): string | null {
  let digits = input.replace(/\D/g, '');
  if (digits.startsWith('260')) digits = digits.slice(3);
  if (digits.length === 9) digits = `0${digits}`;
  return /^0[579]\d{8}$/.test(digits) ? digits : null;
}

/** Which network a number belongs to, from its prefix. */
export function providerForMobile(phone: string): Provider | null {
  const local = normaliseMobile(phone);
  if (!local) return null;
  const prefix = local.slice(1, 3);
  for (const provider of Object.keys(PREFIXES) as Provider[]) {
    if (PREFIXES[provider].includes(prefix)) return provider;
  }
  return null;
}

/** The outcome the simulation will give a number. Exported for tests and the demo hint. */
export function simulatedOutcome(phone: string): CollectionOutcome {
  const last = phone.replace(/\D/g, '').slice(-1);
  if (last === '0') return 'declined';
  if (last === '8') return 'insufficient';
  if (last === '9') return 'timeout';
  return 'approved';
}

/** A reference in the style providers print, unique enough for matching. */
export function simulatedReference(provider: Provider, now: number = Date.now()): string {
  const code = { MTN: 'MP', Airtel: 'AM', Zamtel: 'ZM' }[provider];
  const tail = Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .toUpperCase()
    .padStart(4, '0');
  return `${code}-SIM-${now.toString(36).toUpperCase()}${tail}`;
}

export class GatewayAbortError extends Error {
  constructor() {
    super('Pay request cancelled');
    this.name = 'GatewayAbortError';
  }
}

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new GatewayAbortError());
    const id = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(id);
      reject(new GatewayAbortError());
    });
  });
}

/** Timings in ms, short enough for a demo, long enough to feel like a real wait. */
export const SIMULATION_TIMING = { send: 900, answer: 3500, timeout: 8000 };

export function createSimulatedGateway(timing = SIMULATION_TIMING): PaymentGateway {
  return {
    simulated: true,
    async collect(request, { onStatus, signal } = {}) {
      const phone = normaliseMobile(request.phone);
      if (!phone) throw new Error('invalid-phone');
      if (!(request.amount > 0)) throw new Error('invalid-amount');

      onStatus?.('sending');
      await wait(timing.send, signal);
      onStatus?.('waiting');

      const outcome = simulatedOutcome(phone);
      await wait(outcome === 'timeout' ? timing.timeout : timing.answer, signal);
      onStatus?.(outcome);

      return outcome === 'approved'
        ? { status: outcome, phone, reference: simulatedReference(request.provider) }
        : { status: outcome, phone };
    },
  };
}

export const paymentGateway: PaymentGateway = createSimulatedGateway();

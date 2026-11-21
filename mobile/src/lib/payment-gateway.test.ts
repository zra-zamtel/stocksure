import { describe, expect, it } from 'vitest';
import {
  createSimulatedGateway,
  GatewayAbortError,
  normaliseMobile,
  providerForMobile,
  simulatedOutcome,
  type CollectionStatus,
} from './payment-gateway';

const fast = createSimulatedGateway({ send: 1, answer: 1, timeout: 1 });

describe('normaliseMobile', () => {
  it('accepts the common ways a Zambian number is typed', () => {
    expect(normaliseMobile('097 123 4567')).toBe('0971234567');
    expect(normaliseMobile('+260 97 123 4567')).toBe('0971234567');
    expect(normaliseMobile('971234567')).toBe('0971234567');
  });

  it('rejects numbers that are not Zambian mobiles', () => {
    expect(normaliseMobile('12345')).toBeNull();
    expect(normaliseMobile('0211234567')).toBeNull();
  });
});

describe('providerForMobile', () => {
  it('reads the network from the prefix', () => {
    expect(providerForMobile('0961234567')).toBe('MTN');
    expect(providerForMobile('0771234567')).toBe('Airtel');
    expect(providerForMobile('0951234567')).toBe('Zamtel');
  });
});

describe('simulated gateway', () => {
  it('picks the outcome from the last digit', () => {
    expect(simulatedOutcome('0971234561')).toBe('approved');
    expect(simulatedOutcome('0971234560')).toBe('declined');
    expect(simulatedOutcome('0971234568')).toBe('insufficient');
    expect(simulatedOutcome('0971234569')).toBe('timeout');
  });

  it('reports each step and returns a reference when approved', async () => {
    const seen: CollectionStatus[] = [];
    const result = await fast.collect(
      { amount: 5000, provider: 'MTN', phone: '096 123 4567' },
      { onStatus: (status) => seen.push(status) },
    );
    expect(seen).toEqual(['sending', 'waiting', 'approved']);
    expect(result.phone).toBe('0961234567');
    expect(result.reference).toMatch(/^MP-SIM-/);
  });

  it('returns no reference when the customer declines', async () => {
    const result = await fast.collect({ amount: 5000, provider: 'Airtel', phone: '0971234560' }, {});
    expect(result).toEqual({ status: 'declined', phone: '0971234560' });
  });

  it('refuses a bad number before sending anything', async () => {
    await expect(fast.collect({ amount: 5000, provider: 'MTN', phone: '123' }, {})).rejects.toThrow('invalid-phone');
  });

  it('stops when cancelled', async () => {
    const slow = createSimulatedGateway({ send: 50, answer: 50, timeout: 50 });
    const controller = new AbortController();
    const pending = slow.collect({ amount: 5000, provider: 'MTN', phone: '0961234567' }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toBeInstanceOf(GatewayAbortError);
  });
});

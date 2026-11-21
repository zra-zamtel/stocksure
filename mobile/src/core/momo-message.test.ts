import { describe, expect, it } from 'vitest';
import { parsePaymentMessage } from './momo-message';

// Messages in the shape the providers send. Exact wording varies by provider
// and changes over time, so these check the parts that carry the facts.
describe('parsePaymentMessage', () => {
  it('reads an MTN MoMo receipt', () => {
    const parsed = parsePaymentMessage(
      'You have received ZMW 250.00 from JOHN BANDA (260961234567) on 17/11/2026 09:16. ' +
        'Financial Transaction Id: 8812345678. Your new balance: ZMW 1,520.40.'
    );
    expect(parsed).toMatchObject({
      provider: undefined,
      amount: 25000,
      reference: '8812345678',
      sender: 'JOHN BANDA (260961234567)',
      outgoing: false,
    });
    expect(new Date(parsed.receivedAt!).getHours()).toBe(9);
  });

  it('names MTN when the message says MoMo', () => {
    expect(parsePaymentMessage('MoMo: You have received K40.00 from Mary. Ref MP261117.0916').provider).toBe('MTN');
  });

  it('reads an Airtel Money receipt', () => {
    const parsed = parsePaymentMessage(
      'Airtel Money: Txn ID PP261117.1102.A12345. You have received ZMW50.00 from 0971234567 GRACE PHIRI. Bal: ZMW 300.00'
    );
    expect(parsed).toMatchObject({
      provider: 'Airtel',
      amount: 5000,
      reference: 'PP261117.1102.A12345',
      outgoing: false,
    });
  });

  it('reads a Zamtel Kwacha receipt', () => {
    const parsed = parsePaymentMessage(
      'Zamtel Kwacha: You have received K450.00 from Grace Phiri. Transaction ID ZK2611171500.'
    );
    expect(parsed).toMatchObject({ provider: 'Zamtel', amount: 45000, reference: 'ZK2611171500', sender: 'Grace Phiri' });
  });

  it('takes the received amount, not the balance or a fee', () => {
    expect(parsePaymentMessage('Your balance is K2,000.00. You have received K75.50 from Ann.').amount).toBe(7550);
    expect(parsePaymentMessage('Fee K2.00. Credited K120 to your wallet.').amount).toBe(12000);
  });

  it('flags money sent out, so it is not taken for a sale', () => {
    expect(parsePaymentMessage('You have sent K100.00 to PETER. Ref 123456789').outgoing).toBe(true);
  });

  it('reports what it cannot find instead of guessing', () => {
    expect(parsePaymentMessage('hello there')).toEqual({
      provider: undefined,
      amount: undefined,
      reference: undefined,
      sender: undefined,
      receivedAt: undefined,
      outgoing: false,
    });
  });
});

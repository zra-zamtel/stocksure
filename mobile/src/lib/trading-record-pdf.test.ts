import { describe, expect, it } from 'vitest';
import type { IssuedTradingRecord } from './api';
import { longDate, tradingRecordHtml } from './trading-record-pdf';

function record(overrides: Partial<IssuedTradingRecord> = {}): IssuedTradingRecord {
  return {
    id: 'r1',
    periodMonths: 3,
    periodStart: '2026-08-01',
    periodEnd: '2026-10-31',
    includeMargin: false,
    includeTax: false,
    issuedAt: '2026-11-26T10:00:00+02:00',
    expiresAt: '2026-12-10T10:00:00+02:00',
    revokedAt: null,
    state: 'valid',
    viewCount: 0,
    lastViewedAt: null,
    seal: 'ABCD-1234-EF56-7890',
    payloadHash: 'abcd1234',
    token: 'tok',
    verifyUrl: 'https://api.example/verify/tok/',
    qrSvg: 'data:image/svg+xml,%3Csvg%3E%3C/svg%3E',
    payload: {
      schema: 'stocksure.trading-record.v1',
      record_id: 'r1',
      issued_at: '2026-11-26T10:00:00+02:00',
      expires_at: '2026-12-10T10:00:00+02:00',
      currency: 'ZMW',
      business: { name: 'Mwila <Shoes> & Co', town: 'Kabwe', type: 'other', owner_name: 'Mwila' },
      period: { months: 3, start: '2026-08-01', end: '2026-10-31' },
      totals: {
        recorded_sales: 100000,
        sale_count: 10,
        trading_days: 5,
        mobile_money_matched: 50000,
        cash_balanced_close: 30000,
        recorded_only: 20000,
      },
      cash_closes: { days_closed: 5, days_balanced: 4, days_not_balanced: 1 },
      months: [
        {
          month: '2026-08',
          recorded_sales: 100000,
          sale_count: 10,
          trading_days: 5,
          mobile_money_matched: 50000,
          cash_balanced_close: 30000,
          recorded_only: 20000,
        },
      ],
      data: {
        first_synced_at: '2026-07-01T09:00:00+02:00',
        data_through: '2026-10-31',
        late_sync_days: 7,
        synced_late_value: 0,
        sync_time_unknown_value: 0,
      },
      margin: null,
      tax: null,
      labels: {},
      not_this: ['Not a credit score.'],
    },
    ...overrides,
  };
}

describe('tradingRecordHtml', () => {
  it('shows the three evidence lines separately, with shares', () => {
    const html = tradingRecordHtml(record());
    expect(html).toContain('Matched to a provider confirmation SMS stored on the phone');
    expect(html).toContain('class="bar"');
    expect(html).toContain('(50%)');
    expect(html).toContain('(30%)');
    expect(html).toContain('Self-reported, not backed by either check');
    expect(html).toContain('ABCD-1234-EF56-7890');
    expect(html).toContain('https://api.example/verify/tok/');
    expect(html).toContain('Aug 2026');
  });

  it('escapes owner-typed text', () => {
    const html = tradingRecordHtml(record());
    expect(html).toContain('Mwila &lt;Shoes&gt; &amp; Co');
    expect(html).not.toContain('<Shoes>');
  });

  it('only embeds an SVG data URI as the QR code', () => {
    expect(tradingRecordHtml(record())).toContain('<img src="data:image/svg+xml');
    const bad = tradingRecordHtml(record({ qrSvg: 'javascript:alert(1)' }));
    expect(bad).not.toContain('javascript:');
    const quoted = tradingRecordHtml(record({ qrSvg: 'data:image/svg+xml," onerror="x' }));
    expect(quoted).not.toContain('onerror');
  });

  it('leaves out margin and tax unless shared', () => {
    expect(tradingRecordHtml(record())).not.toContain('Gross margin');
    expect(tradingRecordHtml(record())).not.toContain('Tax (draft');
  });
});

describe('longDate', () => {
  it('formats dates and timestamps', () => {
    expect(longDate('2026-05-01')).toBe('1 May 2026');
    expect(longDate('2026-11-26T10:00:00+02:00')).toBe('26 Nov 2026');
    expect(longDate(null)).toBe('—');
  });
});

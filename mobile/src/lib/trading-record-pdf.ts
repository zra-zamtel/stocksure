import type { IssuedTradingRecord } from './api';
import { formatKwacha } from './format';

/**
 * The printable Trading Record. The PDF only carries the figures; the QR code
 * and link are the proof, because the server re-checks the seal when a bank
 * officer opens them. Pure function so it can be unit-tested without a device.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function share(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part * 100) / whole)}%` : '—';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-05-01' -> '1 May 2026'; timestamps keep only their date. */
export function longDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return y && m ? `${MONTHS[m - 1]} ${y}` : key;
}

/** Only an SVG data URI from our own server is embedded. */
function safeQr(qrSvg: string): string | null {
  return /^data:image\/svg\+xml[;,]/.test(qrSvg) && !/["<>]/.test(qrSvg) ? qrSvg : null;
}

export function tradingRecordHtml(record: IssuedTradingRecord): string {
  const p = record.payload;
  const t = p.totals;
  const k = formatKwacha;
  const qr = safeQr(record.qrSvg);

  const months = p.months
    .map(
      (m) =>
        `<tr><td>${monthLabel(m.month)}</td><td>${k(m.recorded_sales)}</td><td>${k(m.mobile_money_matched)}</td>` +
        `<td>${k(m.cash_balanced_close)}</td><td>${k(m.recorded_only)}</td><td>${m.trading_days}</td></tr>`
    )
    .join('');

  const margin = p.margin
    ? `<h2>Gross margin (shared by the owner)</h2>
       <p>Sales ${k(p.margin.revenue)} · Cost of goods ${k(p.margin.cost_of_goods)} ·
       <b>Gross margin ${k(p.margin.gross_margin)} (${(p.margin.gross_margin_bp / 100).toFixed(1)}%)</b></p>
       <p class="muted">${escapeHtml(p.margin.note)}</p>`
    : '';

  const tax = p.tax
    ? `<h2>Tax (draft estimate, supporting only)</h2>
       ${
         p.tax.periods.length
           ? `<table><thead><tr><th>Period</th><th>Declared turnover</th><th>Corroborated</th><th>Variance</th></tr></thead><tbody>${p.tax.periods
               .map(
                 (row) =>
                   `<tr><td>${longDate(row.starts_on)} – ${longDate(row.ends_on)}</td><td>${k(row.declared_turnover)}</td>` +
                   `<td>${k(row.corroborated_sales)}</td><td>${k(row.variance_vs_corroborated)}</td></tr>`
               )
               .join('')}</tbody></table>`
           : '<p class="muted">No tax periods fall fully inside this period.</p>'
       }
       <p class="muted">${escapeHtml(p.tax.filing)} ${escapeHtml(p.tax.note)}</p>`
    : '';

  const bar =
    t.recorded_sales > 0
      ? `<div class="bar"><span style="flex:${t.mobile_money_matched};background:#1E7A3C"></span>` +
        `<span style="flex:${t.cash_balanced_close};background:#0B4A8F"></span>` +
        `<span style="flex:${t.recorded_only};background:#B9AB90"></span></div>`
      : '';

  const lateNote =
    p.data.synced_late_value > 0
      ? `${k(p.data.synced_late_value)} of sales reached StockSure more than ${p.data.late_sync_days} days after they were recorded.`
      : `All sales reached StockSure within ${p.data.late_sync_days} days of being recorded.`;

  return `<!doctype html><html><head><meta charset="utf-8">
<style>
  /* StockSure brand tokens, light theme (prints on white). */
  @page { margin: 18mm 14mm; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { font-family: -apple-system, Roboto, "Segoe UI", sans-serif; color: #1E1E1C; font-size: 11pt; line-height: 1.4; }
  h1 { font-size: 18pt; margin: 0; }
  h2 { font-size: 9.5pt; text-transform: uppercase; letter-spacing: .08em; color: #6B655B; margin: 18px 0 6px; }
  .muted { color: #6B655B; font-size: 9pt; }
  .top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
  .qr { text-align: center; width: 150px; }
  .qr img { width: 140px; height: 140px; }
  .bar { display: flex; gap: 2px; height: 10px; border-radius: 5px; overflow: hidden; margin: 4px 0 8px; background: #EDE5D6; }
  .bar span { min-width: 3px; }
  .line { display: flex; align-items: flex-start; gap: 10px; padding: 8px 10px; border-radius: 6px; margin: 4px 0; }
  .line svg { width: 16px; height: 16px; flex: none; margin-top: 2px; }
  .line .txt { flex: 1; } .line .lab { font-weight: 700; } .line .why { color: #6B655B; font-size: 9pt; }
  .line b { font-variant-numeric: tabular-nums; color: #1E1E1C; white-space: nowrap; }
  .l1 { background: #E6F4EA; color: #1E7A3C; } .l2 { background: #E7F0FB; color: #0B4A8F; } .l3 { background: #EDE5D6; color: #6B655B; }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; font-variant-numeric: tabular-nums; }
  th, td { padding: 4px 6px; border-bottom: 1px solid #D8CBB3; text-align: right; }
  th:first-child, td:first-child { text-align: left; }
  th { color: #6B655B; font-weight: 600; }
  tr, .line, .box { break-inside: avoid; }
  .seal { font-family: Menlo, Consolas, monospace; font-size: 14pt; font-weight: 700; letter-spacing: .05em; }
  .box { border: 1px solid #D8CBB3; border-radius: 8px; padding: 10px 12px; margin-top: 14px; }
</style></head><body>
<div class="top">
  <div>
    <div class="muted">StockSure · Trading Record</div>
    <h1>${escapeHtml(p.business.name)}</h1>
    <div>${escapeHtml([p.business.town, p.business.owner_name ? `Owner: ${p.business.owner_name}` : ''].filter(Boolean).join(' · '))}</div>
    <p><b>${longDate(p.period.start)} – ${longDate(p.period.end)}</b> (${p.period.months} months)<br>
    <span class="muted">Issued ${longDate(p.issued_at)} · Check online before ${longDate(p.expires_at)}</span></p>
  </div>
  <div class="qr">
    ${qr ? `<img src="${qr}" alt="QR code">` : ''}
    <div class="muted">Scan to check this record</div>
  </div>
</div>

<h2>Sales by strength of evidence</h2>
${bar}
<div class="line l1"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2 4 5v6c0 5 3.4 9.7 8 11 4.6-1.3 8-6 8-11V5l-8-3Zm-1.2 14.2-3.5-3.5 1.4-1.4 2.1 2.1 4.9-4.9 1.4 1.4-6.3 6.3Z"/></svg><div class="txt"><div class="lab">Mobile money matched</div><div class="why">Matched to a provider confirmation SMS stored on the phone</div></div><b>${k(t.mobile_money_matched)} (${share(t.mobile_money_matched, t.recorded_sales)})</b></div>
<div class="line l2"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v18M5 21h14M6 7h12M6 7l-3 7a3 3 0 0 0 6 0L6 7Zm12 0-3 7a3 3 0 0 0 6 0l-3-7Z"/></svg><div class="txt"><div class="lab">Cash, balanced close</div><div class="why">Cash on days the count matched the expected cash (${p.cash_closes.days_balanced} of ${p.cash_closes.days_closed} closed days). A consistency check, not proof</div></div><b>${k(t.cash_balanced_close)} (${share(t.cash_balanced_close, t.recorded_sales)})</b></div>
<div class="line l3"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h10M4 11h10M4 16h6M14.5 19.5 20 14l-2-2-5.5 5.5-.5 2.5 2.5-.5Z"/></svg><div class="txt"><div class="lab">Recorded only</div><div class="why">Self-reported, not backed by either check</div></div><b>${k(t.recorded_only)} (${share(t.recorded_only, t.recorded_sales)})</b></div>
<p><b>All recorded sales: ${k(t.recorded_sales)}</b> · ${t.sale_count} sales on ${t.trading_days} trading days. Voided sales excluded.</p>

<h2>Month by month</h2>
<table><thead><tr><th>Month</th><th>Recorded</th><th>MoMo matched</th><th>Cash balanced</th><th>Recorded only</th><th>Days</th></tr></thead>
<tbody>${months}</tbody></table>

<h2>When the data reached StockSure</h2>
<p>First synced ${longDate(p.data.first_synced_at)} · Data through ${longDate(p.data.data_through)}<br>${lateNote}</p>

${margin}
${tax}

<div class="box">
  <div class="muted">Seal (must match the verification page)</div>
  <div class="seal">${escapeHtml(record.seal)}</div>
  <div class="muted" style="word-break: break-all">${escapeHtml(record.verifyUrl)}</div>
  <p class="muted">The QR code and link are the proof; this PDF only carries the figures. ${p.not_this.map(escapeHtml).join(' ')}
  Totals only: no customer names, phone numbers or product details. Shared with the owner's consent (Zambia Data Protection Act, 2021).</p>
</div>
</body></html>`;
}

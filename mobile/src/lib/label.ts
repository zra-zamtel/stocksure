import { encodeEan13 } from '@/core';

/**
 * Label output has to leave the phone, so the barcode is emitted as SVG: sharp
 * at any print size, and small enough to inline in a print document.
 */

export function ean13Svg(
  code: string,
  options: { moduleWidth?: number; height?: number; quietZone?: number } = {}
): string {
  const bits = encodeEan13(code);
  const moduleWidth = options.moduleWidth ?? 2;
  const height = options.height ?? 80;
  const quietZone = options.quietZone ?? 10;

  const width = (bits.length + quietZone * 2) * moduleWidth;
  const textHeight = 16;
  const totalHeight = height + textHeight;

  // Merge runs of bars: fewer nodes keeps the printed document small.
  const bars: string[] = [];
  let x = quietZone * moduleWidth;
  let index = 0;
  while (index < bits.length) {
    if (bits[index] === '1') {
      let run = 1;
      while (index + run < bits.length && bits[index + run] === '1') run += 1;
      bars.push(
        `<rect x="${x}" y="0" width="${run * moduleWidth}" height="${height}" fill="#000000"/>`
      );
      x += run * moduleWidth;
      index += run;
    } else {
      x += moduleWidth;
      index += 1;
    }
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalHeight}" viewBox="0 0 ${width} ${totalHeight}">`,
    `<rect width="100%" height="100%" fill="#ffffff"/>`,
    ...bars,
    `<text x="${width / 2}" y="${height + 12}" text-anchor="middle" font-family="monospace" font-size="11" letter-spacing="2">${code}</text>`,
    `</svg>`,
  ].join('');
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface LabelContent {
  shopName: string;
  productName: string;
  priceText: string;
  code: string;
}

/**
 * A single label laid out at roughly 68 mm wide, which prints sensibly on a
 * thermal label roll and still works on A4 when cut out.
 */
export function labelHtml(content: LabelContent): string {
  const barcode = ean13Svg(content.code);
  return `<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      @page { margin: 8mm; }
      body { font-family: -apple-system, Roboto, Arial, sans-serif; margin: 0; color: #111; }
      .label { width: 68mm; padding: 3mm; }
      .shop { font-size: 8pt; letter-spacing: 0.4pt; text-transform: uppercase; color: #555; }
      .name { font-size: 11pt; font-weight: 700; margin: 1mm 0; }
      .price { font-size: 10pt; font-weight: 600; margin-bottom: 1mm; }
      .barcode svg { width: 64mm; height: auto; display: block; }
      .hint { font-size: 7pt; color: #777; margin-top: 1mm; }
    </style>
  </head>
  <body>
    <div class="label">
      <div class="shop">${escapeHtml(content.shopName)}</div>
      <div class="name">${escapeHtml(content.productName)}</div>
      <div class="price">${escapeHtml(content.priceText)}</div>
      <div class="barcode">${barcode}</div>
      <div class="hint">In-store barcode</div>
    </div>
  </body>
</html>`;
}

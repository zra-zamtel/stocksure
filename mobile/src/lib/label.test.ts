import { describe, expect, it } from 'vitest';
import { ean13Svg, escapeHtml, labelHtml } from './label';

const CODE = '5901234123457';

describe('barcode label output', () => {
  it('emits a self-contained SVG with the code underneath', () => {
    const svg = ean13Svg(CODE);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg.endsWith('</svg>')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    expect(svg).toContain(CODE);
    expect((svg.match(/<rect/g) ?? []).length).toBeGreaterThan(20);
  });

  it('keeps a white background so bars stay scannable', () => {
    expect(ean13Svg(CODE)).toContain('fill="#ffffff"');
  });

  it('refuses to draw an invalid code', () => {
    expect(() => ean13Svg('5901234123458')).toThrow();
  });

  it('escapes text that goes into the print document', () => {
    expect(escapeHtml(`<b>"Tom & Jerry's"</b>`)).toBe(
      '&lt;b&gt;&quot;Tom &amp; Jerry&#39;s&quot;&lt;/b&gt;'
    );
  });

  it('builds a printable label with the product details', () => {
    const html = labelHtml({
      shopName: 'Chiwala Fashions',
      productName: 'Black school shoes',
      priceText: 'K 280.00',
      code: CODE,
    });
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('Chiwala Fashions');
    expect(html).toContain('K 280.00');
    expect(html).toContain('<svg');
    expect(html).toContain('@page');
  });

  it('cannot be broken out of by a product name containing markup', () => {
    const html = labelHtml({
      shopName: 'Shop',
      productName: '<script>alert(1)</script>',
      priceText: 'K 1.00',
      code: CODE,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

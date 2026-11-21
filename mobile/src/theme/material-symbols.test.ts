import { describe, expect, it } from 'vitest';
// The package's exports hide this file from imports by name, so read it by path.
import shipped from '../../node_modules/expo-symbols/build/android/symbols.json';
import glyphs from './material-symbols.json';

// The Icon component draws glyphs from this copy of expo-symbols' name→codepoint
// map (the package does not export it). After upgrading expo-symbols, refresh
// the copy: cp node_modules/expo-symbols/build/android/symbols.json src/theme/material-symbols.json
describe('material symbol glyph map', () => {
  it('matches the map shipped with the installed expo-symbols', () => {
    expect(glyphs).toEqual(shipped);
  });

  it('has a glyph for the icons the app relies on', () => {
    const map = glyphs as Record<string, number>;
    for (const name of ['visibility', 'visibility_off', 'arrow_back', 'check', 'chevron_right', 'storefront']) {
      expect(map[name], name).toBeGreaterThan(0);
    }
  });
});

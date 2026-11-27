import { describe, expect, it } from 'vitest';
import en from '../i18n/en.json';
import ny from '../i18n/ny.json';
import glyphs from '../theme/material-symbols.json';
import {
  PROFILES,
  PROFILE_BY_ID,
  attributesKey,
  attributesOf,
  cleanAttributes,
  legacyTypeForProfile,
  profileForShop,
  variantLabel,
} from './profiles';
import type { ShopType } from './types';

const LEGACY_TYPES: ShopType[] = ['clothes', 'shoes', 'general', 'other'];
const strings = en as Record<string, string>;
const nyStrings = ny as Record<string, string>;

describe('shop profile catalogue', () => {
  it('has unique ids, all reachable by id', () => {
    const ids = PROFILES.map((profile) => profile.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const profile of PROFILES) expect(PROFILE_BY_ID[profile.id]).toBe(profile);
  });

  it('gives every profile at least one category and one unit, and a default unit it lists', () => {
    for (const profile of PROFILES) {
      expect(profile.categories.length, profile.id).toBeGreaterThan(0);
      expect(profile.units.length, profile.id).toBeGreaterThan(0);
      expect(profile.units, profile.id).toContain(profile.defaultUnit);
    }
  });

  it('keeps to at most two variant axes, each fully described', () => {
    for (const profile of PROFILES) {
      expect(profile.axes.length, profile.id).toBeLessThanOrEqual(2);
      const keys = profile.axes.map((axis) => axis.key);
      expect(new Set(keys).size, profile.id).toBe(keys.length);
      for (const axis of profile.axes) {
        expect(axis.key, profile.id).not.toBe('');
        expect(axis.labelKey, profile.id).not.toBe('');
        expect(axis.placeholder, profile.id).not.toBe('');
        expect(axis.maxLength, profile.id).toBeGreaterThan(0);
        expect(strings[axis.labelKey], axis.labelKey).toBeTruthy();
      }
    }
  });

  it('has English and Nyanja text for every name and caption', () => {
    for (const profile of PROFILES) {
      for (const key of [profile.nameKey, profile.captionKey]) {
        expect(strings[key], key).toBeTruthy();
        expect(nyStrings[key], `ny ${key}`).toBeTruthy();
      }
    }
  });

  it('uses icons the app can draw', () => {
    const map = glyphs as Record<string, number>;
    for (const profile of PROFILES) expect(map[profile.icon], profile.icon).toBeGreaterThan(0);
  });

  it('maps every profile to a valid legacy shop type', () => {
    for (const profile of PROFILES) {
      expect(LEGACY_TYPES).toContain(legacyTypeForProfile(profile.id));
    }
    expect(legacyTypeForProfile('fashion')).toBe('clothes');
  });
});

describe('profileForShop', () => {
  it('uses the stored profile when it is known', () => {
    expect(profileForShop({ profileId: 'bar', type: 'other' }).id).toBe('bar');
  });

  it('falls back from the legacy type for older rows', () => {
    expect(profileForShop({ type: 'clothes' }).id).toBe('fashion');
    expect(profileForShop({ type: 'shoes' }).id).toBe('fashion');
    expect(profileForShop({ profileId: null, type: 'general' }).id).toBe('general');
    expect(profileForShop({ type: 'other' }).id).toBe('general');
  });

  it('treats unknown ids and missing shops as general goods', () => {
    expect(profileForShop({ profileId: 'restaurant' }).id).toBe('general');
    expect(profileForShop({ profileId: 'restaurant', type: 'clothes' }).id).toBe('fashion');
    expect(profileForShop(null).id).toBe('general');
    expect(profileForShop(undefined).id).toBe('general');
  });
});

describe('variantLabel', () => {
  it('joins attribute values when present', () => {
    expect(
      variantLabel('Castle Lager', {
        size: 'ignored',
        attributes: [
          { key: 'pack', value: 'Crate' },
          { key: 'size', value: '330 ml' },
        ],
      })
    ).toBe('Castle Lager · Crate · 330 ml');
  });

  it('falls back to the legacy size and colour', () => {
    expect(variantLabel('Shirt', { size: 'M', colour: 'Blue' })).toBe('Shirt · M · Blue');
    expect(variantLabel('Shirt', { size: null, colour: 'Blue' })).toBe('Shirt · Blue');
    expect(variantLabel('Shirt', { attributes: [] , size: 'L' })).toBe('Shirt · L');
  });

  it('leaves out empty values and an empty name', () => {
    expect(variantLabel('Soap', {})).toBe('Soap');
    expect(variantLabel('', { size: 'M', colour: '' })).toBe('M');
    expect(variantLabel('', {})).toBe('');
  });
});

describe('variant attributes', () => {
  it('reads the stored list, falling back to size and colour', () => {
    expect(attributesOf({ attributesJson: '[{"key":"pack","value":"Crate"}]', size: 'Crate' })).toEqual([
      { key: 'pack', value: 'Crate' },
    ]);
    expect(attributesOf({ size: 'M', colour: 'Blue' })).toEqual([
      { key: 'size', value: 'M' },
      { key: 'colour', value: 'Blue' },
    ]);
    expect(attributesOf({ attributesJson: 'not json', colour: 'Red' })).toEqual([{ key: 'colour', value: 'Red' }]);
    expect(attributesOf({ attributesJson: '{"key":"size"}', size: 'L' })).toEqual([{ key: 'size', value: 'L' }]);
    expect(attributesOf({ attributesJson: '[{"key":"size"},{"key":"pack","value":"Can"}]' })).toEqual([
      { key: 'pack', value: 'Can' },
    ]);
    expect(attributesOf({})).toEqual([]);
  });

  it('treats the same values in another case or spacing as one variant', () => {
    expect(attributesKey([{ key: 'pack', value: ' Crate ' }])).toBe(attributesKey([{ key: 'pack', value: 'crate' }]));
    expect(attributesKey([{ key: 'pack', value: 'Crate' }])).not.toBe(attributesKey([{ key: 'pack', value: 'Can' }]));
    expect(attributesKey([{ key: 'size', value: '' }])).toBe('');
    expect(cleanAttributes([{ key: 'size', value: ' M ' }, { key: 'colour', value: '  ' }])).toEqual([
      { key: 'size', value: 'M' },
    ]);
  });
});

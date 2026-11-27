import { useSyncExternalStore } from 'react';
import { Appearance } from 'react-native';
import Storage from 'expo-sqlite/kv-store';

// Design tokens. Screens must reference these, never raw hex or pixel values.
//
// Light and dark are designed together (warm charcoal, never pure black or an
// inverted light theme). Every text pair is checked for 4.5:1. `colors` and
// `chart` always answer for the active theme; module-level style sheets are
// wrapped in `themed()` so they are rebuilt for it.

const light = {
  // Brand: Charcoal, Sand and Electric Blue on warm paper.
  bg: '#F5F0E6', // paper
  surface: '#FBF8F2', // cards sit a shade lighter than the paper
  surfaceAlt: '#EDE5D6',
  border: '#D8CBB3', // sand
  text: '#1E1E1C', // charcoal
  textMuted: '#6B655B',
  primary: '#2F6BFF', // electric blue, for fills (white text on it is 4.5:1)
  primaryInk: '#2559D9', // blue for text and icons on paper (5.3:1)
  primarySoft: '#E4ECFF',
  primaryText: '#FFFFFF',
  charcoal: '#1E1E1C',
  sand: '#D8CBB3',
  danger: '#B3261E',
  dangerSoft: '#FBEAE8',
  warning: '#8A5A00',
  warningSoft: '#FFF4DA',
  success: '#1E7A3C',
  successSoft: '#E6F4EA',
  info: '#0B4A8F',
  infoSoft: '#E7F0FB',
  // The one dark surface: the hero card that answers "how is today going?".
  ink: '#1E1E1C',
  onInk: '#FBF8F2',
  onInkMuted: '#B9B2A5', // 8.4:1 on ink
  inkLine: '#3A3935',
  successOnInk: '#6FD39A',
  blueOnInk: '#8FB1FF',
  // Android press ripple, a faint charcoal so it reads on paper and on cards.
  ripple: 'rgba(30, 30, 28, 0.08)',
  // A red button's fill; `danger` is tuned for text and icons.
  dangerFill: '#B3261E',
  // The opposite of the page, for a selected segment or chip: a fill and the
  // text on it. `charcoal` is brand ink (it flips), so never put text on it.
  inverse: '#1E1E1C',
  onInverse: '#FFFFFF',
  // Dims the page behind a sheet.
  scrim: 'rgba(20, 19, 18, 0.45)',
  // A pale disc behind an icon on a blue fill.
  onPrimaryTint: 'rgba(255, 255, 255, 0.18)',
};

export type Palette = { [K in keyof typeof light]: string };

const dark: Palette = {
  // Warm charcoal paper, cards a step lighter, sand turned to a dim rule.
  bg: '#141312',
  surface: '#1D1C1A',
  surfaceAlt: '#292724',
  border: '#3B3833',
  text: '#F2EDE3', // 14.6:1 on surface
  textMuted: '#ABA396', // 6.8:1 on surface
  primary: '#2A63F5', // fills; white on it is 5.0:1
  primaryInk: '#8FB1FF', // blue text and icons, 8.0:1 on surface
  primarySoft: '#1B2540',
  primaryText: '#FFFFFF',
  charcoal: '#F2EDE3', // the brand ink flips to paper so the mark still reads
  sand: '#3B3833',
  danger: '#FF8F87',
  dangerSoft: '#3A1D1A',
  warning: '#F0C063',
  warningSoft: '#33280F',
  success: '#71D49B',
  successSoft: '#14301F',
  info: '#94BCF2',
  infoSoft: '#172536',
  // The hero card stays the darkest-feeling surface by lifting it, not sinking it.
  ink: '#262420',
  onInk: '#FBF8F2',
  onInkMuted: '#B9B2A5',
  inkLine: '#3B3833',
  successOnInk: '#6FD39A',
  blueOnInk: '#8FB1FF',
  ripple: 'rgba(255, 255, 255, 0.10)',
  dangerFill: '#D93A33', // white on it is 4.6:1
  inverse: '#F2EDE3',
  onInverse: '#141312', // 15.9:1 on inverse
  scrim: 'rgba(0, 0, 0, 0.6)',
  onPrimaryTint: 'rgba(255, 255, 255, 0.18)',
};

type ChartTokens = {
  accent: string;
  muted: string;
  grid: string;
  axis: string;
  series: readonly string[];
  seriesInk: readonly string[];
};

// Chart colours, checked with the dataviz palette validator against the card
// surface. Categorical slots are handed out in this fixed order, never cycled;
// the lighter blue is the "everything else" step beside the highlighted bar.
const chartLight: ChartTokens = {
  accent: '#2F6BFF',
  muted: '#6DA7EC',
  grid: '#E6DFD1',
  axis: '#C9BCA4',
  series: ['#2F6BFF', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4'],
  /** Ink for a label printed inside a series fill, by slot. */
  seriesInk: ['#FFFFFF', '#FFFFFF', '#FFFFFF', '#1E1E1C', '#FFFFFF'],
};

const chartDark: ChartTokens = {
  accent: '#4F82FF',
  muted: '#3F5F99',
  grid: '#2E2B27',
  axis: '#4A463F',
  series: ['#4F82FF', '#F07A4A', '#2FC28B', '#F0B429', '#EE8FB3'],
  seriesInk: ['#141312', '#1E1E1C', '#1E1E1C', '#1E1E1C', '#1E1E1C'],
};

/**
 * Tints for a product with no photo yet. Muted and kept apart from the status
 * colours (blue = act, green = fine, amber = check, red = problem), so a
 * product tile never reads as a warning. The icon on each is at least 4.5:1.
 */
export type TileTint = { bg: string; fg: string };

const tilesLight: readonly TileTint[] = [
  { bg: '#F1DCCB', fg: '#7A3E1D' }, // clay
  { bg: '#D3E8E3', fg: '#1F5C52' }, // teal
  { bg: '#E5DAED', fg: '#5B3473' }, // plum
  { bg: '#E2E5C8', fg: '#4A5214' }, // olive
  { bg: '#D6E3F3', fg: '#244A7A' }, // sky
  { bg: '#EEE2C3', fg: '#664F12' }, // sand
];

const tilesDark: readonly TileTint[] = [
  { bg: '#3A2A20', fg: '#F0B999' },
  { bg: '#1E3531', fg: '#8FD3C4' },
  { bg: '#33263B', fg: '#D3B2E6' },
  { bg: '#2F3220', fg: '#C9D18A' },
  { bg: '#1F2C3D', fg: '#9DBDE6' },
  { bg: '#3A321D', fg: '#E3C982' },
];

export type ThemePreference = 'system' | 'light' | 'dark';
export type Scheme = 'light' | 'dark';

const PREFERENCE_KEY = 'stocksure.theme';

function readPreference(): ThemePreference {
  try {
    const value = Storage.getItemSync(PREFERENCE_KEY);
    return value === 'light' || value === 'dark' ? value : 'system';
  } catch {
    return 'system';
  }
}

let preference: ThemePreference = readPreference();
let scheme: Scheme = resolveScheme();
const listeners = new Set<(next: Scheme) => void>();

function resolveScheme(): Scheme {
  if (preference !== 'system') return preference;
  try {
    return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

function applyScheme() {
  const next = resolveScheme();
  if (next === scheme) return;
  scheme = next;
  listeners.forEach((listener) => listener(next));
}

try {
  Appearance.addChangeListener(() => {
    if (preference === 'system') applyScheme();
  });
} catch {
  // No Appearance (tests): the theme stays light.
}

export function currentScheme(): Scheme {
  return scheme;
}

export function themePreference(): ThemePreference {
  return preference;
}

/** Saves the owner's choice and switches the whole app to it. */
export function setThemePreference(next: ThemePreference) {
  preference = next;
  try {
    if (next === 'system') Storage.removeItemSync(PREFERENCE_KEY);
    else Storage.setItemSync(PREFERENCE_KEY, next);
  } catch {
    // The choice still applies for this run.
  }
  applyScheme();
}

export function subscribeScheme(listener: (next: Scheme) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The active scheme, re-rendering when it changes. */
export function useScheme(): Scheme {
  return useSyncExternalStore(subscribeScheme, currentScheme, currentScheme);
}

const palettes: Record<Scheme, Palette> = { light, dark };
const charts: Record<Scheme, ChartTokens> = { light: chartLight, dark: chartDark };

/** The active palette. Read at render (or inside `themed`), never cached. */
export const colors: Palette = new Proxy({} as Palette, {
  get: (_target, key) => palettes[scheme][key as keyof Palette],
});

export const chart: ChartTokens = new Proxy({} as ChartTokens, {
  get: (_target, key) => charts[scheme][key as keyof ChartTokens],
});

/** Product tile tints for the active theme. */
export function tileTints(): readonly TileTint[] {
  return scheme === 'dark' ? tilesDark : tilesLight;
}

/**
 * Builds an object (usually a style sheet) once per theme from a factory that
 * reads `colors`, and answers for the active theme. Wrap every module-level
 * `StyleSheet.create` that uses colours: `themed(() => StyleSheet.create({...}))`.
 */
export function themed<T extends object>(factory: () => T): T {
  const cache: Partial<Record<Scheme, T>> = {};
  const current = () => (cache[scheme] ??= factory());
  return new Proxy({} as T, {
    get: (_target, key) => current()[key as keyof T],
    has: (_target, key) => key in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_target, key) => Object.getOwnPropertyDescriptor(current(), key),
  });
}


// Swiss-style depth: one soft, low shadow for raised cards; nothing floats higher.
export const elevation = {
  card: {
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 1,
  },
  raised: {
    shadowColor: '#3B2F1A',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
} as const;

export const iconSize = { sm: 16, md: 20, lg: 24, xl: 32 } as const;

// Space Grotesk is the brand face: titles and money. Body text stays on the
// system font, which is already tuned for small Android screens.
export const fonts = {
  display: 'SpaceGrotesk_700Bold',
} as const;



export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const radii = {
  sm: 6,
  md: 10,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const typeScale = {
  /** Money on a hero card: the one number the eye should land on. */
  money: 44,
  display: 28,
  title: 22,
  heading: 18,
  body: 16,
  label: 13,
  caption: 12,
} as const;

// Minimum touch target for a counter used one-handed on a cheap Android phone.
export const touch = {
  minHeight: 48,
  minWidth: 48,
  /** The picture-first screens: big enough for a thumb at a busy counter. */
  big: 56,
} as const;

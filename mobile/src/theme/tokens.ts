// Design tokens. Screens must reference these, never raw hex or pixel values.
// When the visual design lands, this file is the only thing that changes.
export const colors = {
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
  pill: 999,
} as const;

export const typeScale = {
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
} as const;

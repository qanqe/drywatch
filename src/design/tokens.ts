/**
 * DryWatch design tokens — verified against robi.work's shipped CSS (2026-11-02).
 * Single source of truth for color, type, spacing, and radius. Do not hardcode
 * values in screens; import from here.
 *
 * Dark is the app default (user decision, 2026-11-04). Light remains available
 * for an optional future toggle. Both scales come from robi.work's real CSS.
 */

export interface ThemeColors {
  background: string;
  surfaceTint: string;
  accent: string; // soft pressed/secondary surface, NOT a vivid accent
  hairlineSoft: string;
  pressed: string;
  border: string;
  textDisabled: string;
  textSecondary: string;
  textMuted: string;
  text: string;
  primary: string; // near-black in light, near-white in dark
  primaryDeep: string;
  white: string; // text on primary buttons
  card: string;
  statusBar: 'light-content' | 'dark-content';
}

const light: ThemeColors = {
  background: '#ffffff', // light-50
  surfaceTint: '#f9fbf6', // light-100
  accent: '#f4f6f2', // light-200
  hairlineSoft: '#ebece8', // light-300
  pressed: '#dcddda', // light-400
  border: '#c8cac7', // light-500
  textDisabled: '#afb1ae', // light-600
  textSecondary: '#929391', // light-700
  textMuted: '#717170', // light-800
  text: '#4e4e4d', // light-900
  primary: '#363635', // light-1000
  primaryDeep: '#1f1f1e', // light-1100
  white: '#ffffff',
  card: '#fdfdfd',
  statusBar: 'dark-content',
};

const dark: ThemeColors = {
  background: '#2b312f', // dark-800
  surfaceTint: '#1a1d1c', // dark-900
  accent: '#404845', // dark-700
  hairlineSoft: '#404845', // dark-700
  pressed: '#404845', // dark-700
  border: '#77827d', // dark-500
  textDisabled: '#5a625f',
  textSecondary: '#a2b0ab', // dark-300
  textMuted: '#9bb0a9',
  text: '#eaf2ef', // dark-50
  primary: '#eaf2ef', // dark-50 — near-white primary on dark
  primaryDeep: '#ffffff',
  white: '#2b312f', // text color on primary buttons (dark bg on light text)
  card: '#242a28',
  statusBar: 'light-content',
};

// App-wide theme. Dark is the default; light ships behind a future toggle.
let current: ThemeColors = dark;

export const theme = {
  get colors(): ThemeColors {
    return current;
  },
  setMode(mode: 'dark' | 'light') {
    current = mode === 'light' ? light : dark;
  },
};

// Convenience re-export for screens: `colors.background` etc.
export const colors = new Proxy({} as ThemeColors, {
  get(_target, prop: string) {
    return (current as unknown as Record<string, string | 'light-content' | 'dark-content'>)[prop];
  },
});

export const fonts = {
  extraLight: 'Lexend-ExtraLight',
  light: 'Lexend-Light',
  regular: 'Lexend-Regular',
  medium: 'Lexend-Medium',
  semiBold: 'Lexend-SemiBold',
  bold: 'Lexend-Bold',
};

// robi.work type usage: h1 = 36px extraLight, dominant body = 14px light,
// secondary = 12px. The wordmark's character (light weight, tight tracking)
// carries across the scale — user decision 2026-11-11: the Home "DryWatch"
// treatment IS the app-wide font direction.
export const type = {
  display: {fontSize: 36, lineHeight: 46, fontFamily: fonts.extraLight, letterSpacing: -0.6},
  title: {fontSize: 20, lineHeight: 30, fontFamily: fonts.light, letterSpacing: -0.3},
  heading: {fontSize: 16, lineHeight: 26, fontFamily: fonts.light, letterSpacing: -0.2},
  body: {fontSize: 14, lineHeight: 24, fontFamily: fonts.light},
  caption: {fontSize: 12, lineHeight: 20, fontFamily: fonts.light},
  label: {fontSize: 11, lineHeight: 16, fontFamily: fonts.light, letterSpacing: 0.4},
};

// robi.work `--radius: .425rem` ≈ 6.8px. RN wants integers.
export const radius = {
  small: 4,
  base: 7,
  large: 10,
};

// 8-point system with the finer steps robi.work uses between.
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
};

export const layout = {
  // robi.work content column: max-w-[min(90vw,48rem)] with border-x
  columnBorderWidth: 1,
  columnMaxWidth: 768, // 48rem at 16px base; phones will never hit this cap
  columnPadding: 16,
};

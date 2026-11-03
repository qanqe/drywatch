/**
 * DryWatch design tokens — verified against robi.work's shipped CSS (2026-11-02).
 * Single source of truth for color, type, spacing, and radius. Do not hardcode
 * values in screens; import from here.
 */

export const colors = {
  // Core scale (robi.work `--light-*`, converted oklch -> hex)
  white: '#ffffff', // light-50, background
  surfaceTint: '#f9fbf6', // light-100
  accent: '#f4f6f2', // light-200 — soft surface color, NOT a vivid accent
  hairlineSoft: '#ebece8', // light-300
  pressed: '#dcddda', // light-400
  border: '#c8cac7', // light-500
  textDisabled: '#afb1ae', // light-600
  textSecondary: '#929391', // light-700
  textMuted: '#717170', // light-800
  text: '#4e4e4d', // light-900, body foreground
  primary: '#363635', // light-1000, near-black primary
  primaryDeep: '#1f1f1e', // light-1100

  card: '#fdfdfd', // robi.work `--card`
};

export const fonts = {
  extraLight: 'Lexend-ExtraLight',
  light: 'Lexend-Light',
  regular: 'Lexend-Regular',
  medium: 'Lexend-Medium',
  semiBold: 'Lexend-SemiBold',
  bold: 'Lexend-Bold',
};

// robi.work type usage: h1 = 36px extraLight, dominant body = 14px light,
// secondary = 12px, one 20px light emphasis, one 16px regular.
export const type = {
  display: {fontSize: 36, lineHeight: 44, fontFamily: fonts.extraLight},
  title: {fontSize: 20, lineHeight: 28, fontFamily: fonts.light},
  heading: {fontSize: 16, lineHeight: 24, fontFamily: fonts.regular},
  body: {fontSize: 14, lineHeight: 22, fontFamily: fonts.light},
  caption: {fontSize: 12, lineHeight: 18, fontFamily: fonts.light},
  label: {fontSize: 11, lineHeight: 16, fontFamily: fonts.medium},
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

// "Powder" look from the design canvas: pale pink ground, burgundy accent,
// Cormorant Garamond for display text and Manrope for everything else.
export const colors = {
  background: '#F7ECE9',
  surface: '#FBF6F3',
  hero: '#E9CDC8',
  text: '#3A1A20',
  textSecondary: '#7A5158',
  textMuted: '#8C666C',
  accent: '#6E1423',
  accentDark: '#4A0D18',
  onAccent: '#FBF6F3',
  border: '#E2C6C1',
  divider: '#EFD9D5',
  accentSoft: '#F0D3D0',
  iconMuted: '#9C6A70',
  tabInactive: '#9C7A80',
  error: '#B3261E',
} as const;

// One family per weight: on Android a custom font ignores fontWeight, so never set it next to these.
// Neither font has Hebrew glyphs; the OS falls back to its system font for them.
export const fonts = {
  display: 'CormorantGaramond_400Regular',
  displayLight: 'CormorantGaramond_300Light',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemiBold: 'Manrope_600SemiBold',
} as const;

import i18n from '@/i18n';

// Light "quiet luxury" look (decided 2026-10-20, replacing "powder"): ivory paper ground,
// near-black ink for text and primary buttons, warm greys in between. The colour comes from
// the clothes, so the UI itself stays neutral.
export const colors = {
  background: '#F7F3EC',
  surface: '#FCFAF6',
  // Linen: photo frames, item tiles, soft panels.
  hero: '#EEE8DE',
  text: '#1E1A17',
  textSecondary: '#57504A',
  textMuted: '#6B635B',
  // Ink: primary buttons, links, selected chips. No coloured accent in the UI.
  accent: '#1E1A17',
  accentDark: '#000000',
  onAccent: '#FCFAF6',
  border: '#DDD5C9',
  divider: '#E9E3D9',
  accentSoft: '#E6DFD3',
  // White border of a photo print in a collage.
  paper: '#FFFFFF',
  iconMuted: '#8A8178',
  tabInactive: '#7A7168',
  error: '#A3261E',
} as const;

// One family per weight: on Android a custom font ignores fontWeight, so never set it next to these.
// Cormorant Garamond and Manrope have no Hebrew glyphs, so Hebrew gets Frank Ruhl Libre and Heebo.
// The language is picked once at start-up (src/i18n), so the choice can be made here.
// `hand` is handwriting for collage captions only, never for UI text.
const latinAndCyrillic = {
  display: 'CormorantGaramond_400Regular',
  displayLight: 'CormorantGaramond_300Light',
  body: 'Manrope_400Regular',
  bodyMedium: 'Manrope_500Medium',
  bodySemiBold: 'Manrope_600SemiBold',
  hand: 'MarckScript_400Regular',
};

const hebrew = {
  display: 'FrankRuhlLibre_400Regular',
  displayLight: 'FrankRuhlLibre_300Light',
  body: 'Heebo_400Regular',
  bodyMedium: 'Heebo_500Medium',
  bodySemiBold: 'Heebo_600SemiBold',
  hand: 'GveretLevin_400Regular',
};

export const fonts = i18n.language === 'he' ? hebrew : latinAndCyrillic;

import i18n from '@/i18n';

// "Maison" look (decided 2026-10-21, after the owner's look at Loewe, Prada, Dior, Bottega):
// a white page, near-black ink, hairlines instead of cards, items on a neutral studio grey as in
// every brand's catalogue, and one bright colour kept for the big editorial blocks only.
export const colors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  // Studio grey under items: photo frames, item tiles, soft panels.
  hero: '#F3F2EF',
  text: '#121212',
  textSecondary: '#4A4A47',
  // 5.3:1 on white, 4.8:1 on the studio grey.
  textMuted: '#6B6B67',
  // Ink: primary buttons, links, selected chips.
  accent: '#121212',
  accentDark: '#000000',
  onAccent: '#FFFFFF',
  border: '#E4E3DF',
  // Hairlines between grid cells and rows.
  divider: '#EBEBE8',
  accentSoft: '#F3F2EF',
  // The one bright colour: editorial blocks (a look, the home hero), never under items or text.
  highlight: '#F2D64B',
  // White border of a photo print in a collage.
  paper: '#FFFFFF',
  iconMuted: '#9A9A96',
  tabInactive: '#8B8B87',
  error: '#A3261E',
} as const;

// One family per weight: on Android a custom font ignores fontWeight, so never set it next to these.
// Cormorant Garamond and Inter Tight have no Hebrew glyphs, so Hebrew gets Frank Ruhl Libre and Heebo.
// The language is picked once at start-up (src/i18n), so the choice can be made here.
// `hand` is handwriting for collage captions only, never for UI text.
const latinAndCyrillic = {
  display: 'CormorantGaramond_400Regular',
  displayLight: 'CormorantGaramond_300Light',
  body: 'InterTight_400Regular',
  bodyLight: 'InterTight_300Light',
  bodyMedium: 'InterTight_500Medium',
  bodySemiBold: 'InterTight_600SemiBold',
  hand: 'MarckScript_400Regular',
};

const hebrew = {
  display: 'FrankRuhlLibre_400Regular',
  displayLight: 'FrankRuhlLibre_300Light',
  body: 'Heebo_400Regular',
  bodyLight: 'Heebo_300Light',
  bodyMedium: 'Heebo_500Medium',
  bodySemiBold: 'Heebo_600SemiBold',
  hand: 'GveretLevin_400Regular',
};

export const fonts = i18n.language === 'he' ? hebrew : latinAndCyrillic;

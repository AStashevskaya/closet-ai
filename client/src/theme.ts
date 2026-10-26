import i18n from '@/i18n';

// "Maison" look (decided 2026-10-21, after the owner's look at Loewe, Prada, Dior, Bottega):
// a white page, hairlines instead of cards, items on a neutral studio grey as in every brand's
// catalogue. Recoloured as "The Thread" (2026-10-26): the ink is a deep cherry thread, soft blocks
// sit on powder blue, and one bright cherry bead marks the small things to act on.
export const colors = {
  background: '#FFFFFF',
  surface: '#FFFFFF',
  // Studio grey under items: photo frames, item tiles, soft panels.
  hero: '#F3F2EF',
  // The thread: text, lines, rails, hangers. 15:1 on white, 12:1 on the ground.
  text: '#4A1520',
  textSecondary: '#5A4247',
  // 6.3:1 on white, 4.9:1 on the ground.
  textMuted: '#6F5A5E',
  // Ink: primary buttons, links, selected chips.
  accent: '#4A1520',
  accentDark: '#2E0C13',
  onAccent: '#FFFFFF',
  border: '#E4E3DF',
  // Hairlines between grid cells and rows.
  divider: '#EBEBE8',
  accentSoft: '#F3F2EF',
  // Powder blue: the soft editorial blocks (a cover, New in, a verdict), with thread-coloured text.
  ground: '#D6E4F1',
  // The bright cherry bead: selected chips, small labels, "+", a yes. Never a big block.
  bead: '#9E1F32',
  // Text and icons on the bead: 7.8:1.
  onBead: '#FFFFFF',
  // White border of a photo print in a collage.
  paper: '#FFFFFF',
  iconMuted: '#9A9A96',
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

import {
  CormorantGaramond_300Light,
  CormorantGaramond_400Regular,
} from '@expo-google-fonts/cormorant-garamond';
import {
  FrankRuhlLibre_300Light,
  FrankRuhlLibre_400Regular,
} from '@expo-google-fonts/frank-ruhl-libre';
import { Heebo_400Regular, Heebo_500Medium, Heebo_600SemiBold } from '@expo-google-fonts/heebo';
import type { FontSource } from 'expo-font';
import {
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
} from '@expo-google-fonts/manrope';

import i18n from '@/i18n';

// Loaded at runtime with useFonts (works in Expo Go). Keys must match `fonts` in theme.ts;
// only the set for the app's language is loaded.
export const fontAssets: Record<string, FontSource> =
  i18n.language === 'he'
    ? {
        FrankRuhlLibre_300Light,
        FrankRuhlLibre_400Regular,
        Heebo_400Regular,
        Heebo_500Medium,
        Heebo_600SemiBold,
      }
    : {
        CormorantGaramond_300Light,
        CormorantGaramond_400Regular,
        Manrope_400Regular,
        Manrope_500Medium,
        Manrope_600SemiBold,
      };

import { CormorantGaramond_300Light } from '@expo-google-fonts/cormorant-garamond/300Light';
import { CormorantGaramond_400Regular } from '@expo-google-fonts/cormorant-garamond/400Regular';
import { FrankRuhlLibre_300Light } from '@expo-google-fonts/frank-ruhl-libre/300Light';
import { FrankRuhlLibre_400Regular } from '@expo-google-fonts/frank-ruhl-libre/400Regular';
import { GveretLevin_400Regular } from '@expo-google-fonts/gveret-levin/400Regular';
import { Heebo_300Light } from '@expo-google-fonts/heebo/300Light';
import { Heebo_400Regular } from '@expo-google-fonts/heebo/400Regular';
import { Heebo_500Medium } from '@expo-google-fonts/heebo/500Medium';
import { Heebo_600SemiBold } from '@expo-google-fonts/heebo/600SemiBold';
import { InterTight_300Light } from '@expo-google-fonts/inter-tight/300Light';
import { InterTight_400Regular } from '@expo-google-fonts/inter-tight/400Regular';
import { InterTight_500Medium } from '@expo-google-fonts/inter-tight/500Medium';
import { InterTight_600SemiBold } from '@expo-google-fonts/inter-tight/600SemiBold';
import { MarckScript_400Regular } from '@expo-google-fonts/marck-script/400Regular';
import type { FontSource } from 'expo-font';

import i18n from '@/i18n';

// Imported weight by weight: a package's main file requires every weight it has, and the
// bundler then ships them all (~11 MB of fonts for the 14 used, 2026-10-22).
// Loaded at runtime with useFonts (works in Expo Go). Keys must match `fonts` in theme.ts;
// only the set for the app's language is loaded.
export const fontAssets: Record<string, FontSource> =
  i18n.language === 'he'
    ? {
        FrankRuhlLibre_300Light,
        FrankRuhlLibre_400Regular,
        Heebo_300Light,
        Heebo_400Regular,
        Heebo_500Medium,
        Heebo_600SemiBold,
        GveretLevin_400Regular,
      }
    : {
        CormorantGaramond_300Light,
        CormorantGaramond_400Regular,
        InterTight_300Light,
        InterTight_400Regular,
        InterTight_500Medium,
        InterTight_600SemiBold,
        MarckScript_400Regular,
      };

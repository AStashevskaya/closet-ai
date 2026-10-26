import { Platform, type ViewStyle } from 'react-native';

import { colors } from '@/theme';

// "The Thread" (2026-10-26): a soft shadow under every cut-out that follows the piece's outline and is
// tinted with the thread colour rather than grey, so pieces have weight instead of looking like stickers.
// Put it on a view with no background that holds only the cut-out:
// - iOS: a layer shadow on a view without a background follows the alpha of what's inside it. Pair it
//   with `shouldRasterizeIOS` where the piece moves (the rails swing), so the shadow is drawn once.
// - Android: `elevation` and `boxShadow` are always rectangles, so it's the `dropShadow` filter, which
//   follows the alpha; Android 12+ only, older phones show the piece without a shadow.
// `hanging`: a piece on a rail or standing on its own, lit from above; `flat`: lying on paper.
const SHADOWS = {
  hanging: { y: 8, blur: 10, opacity: 0.22 },
  flat: { y: 5, blur: 6, opacity: 0.16 },
} as const;

export function cutoutShadow(kind: keyof typeof SHADOWS): ViewStyle {
  const { y, blur, opacity } = SHADOWS[kind];
  if (Platform.OS === 'ios') {
    return {
      shadowColor: colors.text,
      shadowOpacity: opacity,
      shadowRadius: blur,
      shadowOffset: { width: 0, height: y },
    };
  }
  if (Platform.OS === 'android') {
    const alpha = Math.round(opacity * 255)
      .toString(16)
      .padStart(2, '0');
    return {
      filter: [
        {
          dropShadow: {
            offsetX: 0,
            offsetY: y,
            standardDeviation: blur / 2,
            color: `${colors.text}${alpha}`,
          },
        },
      ],
    };
  }
  return {};
}

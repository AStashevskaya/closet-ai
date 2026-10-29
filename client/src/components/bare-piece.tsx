import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { cutoutShadow } from '@/components/cutout-shadow';
import { absoluteUrl } from '@/lib/api';

type Props = {
  // An item, or a styled entry (whose urls are null when missing).
  item: { photoUrl?: string | null; cutoutUrl?: string | null };
  headers: Record<string, string> | undefined;
  // Size; the piece fills it.
  style: StyleProp<ViewStyle>;
};

// A piece on its own, as on Style it's diary (2026-10-28): the cut-out straight on the paper with its
// shadow, no tile and no margins (unlike `ItemPhoto`); a photo without a cut-out fills the frame.
// The image keeps its wrapper either way, so it crossfades when the cut-out arrives.
export function BarePiece({ item, headers, style }: Props) {
  const url = item.cutoutUrl ?? item.photoUrl;
  return (
    <View style={[style, item.cutoutUrl ? cutoutShadow('hanging') : null]}>
      {headers && url && (
        <Image
          source={{ uri: absoluteUrl(url), headers }}
          style={styles.fill}
          contentFit={item.cutoutUrl ? 'contain' : 'cover'}
          transition={200}
          accessibilityIgnoresInvertColors
          testID="bare-piece"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});

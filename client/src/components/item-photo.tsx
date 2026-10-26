import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { cutoutShadow } from '@/components/cutout-shadow';
import { absoluteUrl } from '@/lib/api';
import { colors } from '@/theme';

type Props = {
  item: Pick<Item, 'photoUrl' | 'cutoutUrl'>;
  headers: Record<string, string> | undefined;
  // Size and corners; the photo fills it.
  style: StyleProp<ViewStyle>;
};

// An item's photo: the cut-out, whole and centred on the card colour, once the server has
// removed the background; the photo itself, filling the frame, until then (or when removal is
// off). The two crossfade when the cut-out arrives. The cut-out casts a soft shadow.
export function ItemPhoto({ item, headers, style }: Props) {
  const url = item.cutoutUrl ?? item.photoUrl;
  const image =
    url && headers ? (
      <Image
        source={{ uri: absoluteUrl(url), headers }}
        style={styles.fill}
        contentFit={item.cutoutUrl ? 'contain' : 'cover'}
        transition={200}
        accessibilityIgnoresInvertColors
        testID="item-photo"
      />
    ) : null;
  return (
    <View style={[styles.frame, style]}>
      {item.cutoutUrl ? <View style={styles.cutout}>{image}</View> : image}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: colors.hero,
  },
  fill: {
    flex: 1,
  },
  // Air around the item, as on a catalogue page.
  cutout: {
    flex: 1,
    margin: '13%',
    ...cutoutShadow('hanging'),
  },
});

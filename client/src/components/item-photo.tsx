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
// off). The two crossfade when the cut-out arrives: the image always sits in the same wrapper (a new
// parent would remount it and skip the crossfade), which only gets air and a soft shadow for a cut-out.
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
      <View style={item.cutoutUrl ? styles.cutout : styles.fill}>{image}</View>
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
  // Air around the item, as on a catalogue page; a little more below, so the shadow isn't cut off by
  // the frame on small tiles.
  cutout: {
    flex: 1,
    marginHorizontal: '13%',
    marginTop: '10%',
    marginBottom: '16%',
    ...cutoutShadow('hanging'),
  },
});

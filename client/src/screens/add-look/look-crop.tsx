import type { ItemBox } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useState } from 'react';
import {
  StyleSheet,
  View,
  type ImageStyle,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors } from '@/theme';

type Props = {
  // The local photo that was uploaded; the server read the boxes off the same picture.
  uri: string;
  // Its width over its height.
  aspect: number;
  box: ItemBox;
  // Size and corners of the frame.
  style: StyleProp<ViewStyle>;
};

// Room around the box, as on the server's crop.
const MARGIN = 0.03;

// One item of a look, shown by placing the whole photo behind a small frame so only the
// item's box shows: no cropping on the phone, and the same picture for every item.
export function LookCrop({ uri, aspect, box, style }: Props) {
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const onLayout = ({ nativeEvent }: LayoutChangeEvent) =>
    setFrame({ width: nativeEvent.layout.width, height: nativeEvent.layout.height });

  let image: ImageStyle | null = null;
  if (frame) {
    // The photo measured as aspect × 1; the box with its margin, kept inside the photo.
    const x1 = Math.max(0, box.xMin - MARGIN) * aspect;
    const x2 = Math.min(1, box.xMax + MARGIN) * aspect;
    const y1 = Math.max(0, box.yMin - MARGIN);
    const y2 = Math.min(1, box.yMax + MARGIN);
    // Big enough that the box fills the frame's shorter fit, as contentFit "contain" would.
    const scale = Math.min(frame.width / (x2 - x1), frame.height / (y2 - y1));
    image = {
      position: 'absolute',
      width: aspect * scale,
      height: scale,
      left: frame.width / 2 - ((x1 + x2) / 2) * scale,
      top: frame.height / 2 - ((y1 + y2) / 2) * scale,
    };
  }

  return (
    <View style={[styles.frame, style]} onLayout={onLayout}>
      {image && (
        <Image
          source={{ uri }}
          style={image}
          contentFit="fill"
          accessibilityIgnoresInvertColors
          testID="look-crop"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    overflow: 'hidden',
    backgroundColor: colors.hero,
  },
});

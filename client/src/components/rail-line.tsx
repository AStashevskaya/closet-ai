import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';

import { BeadAcross } from '@/components/thread-stops';
import { colors } from '@/theme';

export const RAIL_WEIGHT = 1.4;

// The rail itself: an ink line across the screen with a bracket at each end. While something is
// waited for the sign of waiting runs along it (docs/design.md, "Waiting"). Decoration, so screen
// readers skip it; `style` places it.
export function RailLine({
  waiting,
  style,
}: {
  // Left out on a rail that never waits, which then needn't carry the sign's motion.
  waiting?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      style={[styles.line, style]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={[styles.bracket, styles.bracketStart]} />
      <View style={[styles.bracket, styles.bracketEnd]} />
      {waiting !== undefined && <BeadAcross waiting={waiting} />}
    </View>
  );
}

const styles = StyleSheet.create({
  line: {
    height: RAIL_WEIGHT,
    backgroundColor: colors.text,
  },
  bracket: {
    position: 'absolute',
    top: -6,
    width: RAIL_WEIGHT,
    height: 13,
    backgroundColor: colors.text,
  },
  bracketStart: {
    start: 6,
  },
  bracketEnd: {
    end: 6,
  },
});

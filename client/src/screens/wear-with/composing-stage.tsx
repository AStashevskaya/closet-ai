import type { Item } from '@closet-ai/shared';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { BarePiece } from '@/components/bare-piece';
import { ClosetBelt } from '@/components/closet-belt';
import { cutoutShadow } from '@/components/cutout-shadow';
import { Hanger, HANGER_HEIGHT, HANGER_PIVOT_Y, HANGER_WIDTH, HANGERS } from '@/components/hanger';
import { RailLine } from '@/components/rail-line';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

import { ComposingSteps } from './composing-steps';

// From the prototype, direction C "Пустая вешалка", state "Собираю": the size the chosen piece grows
// to on the pick screen (96 × 128, grown 1.3), so it looks the same on both screens.
const HANG_WIDTH = 64;
const HANG_PIVOT = (HANGER_PIVOT_Y * HANG_WIDTH) / HANGER_WIDTH;
const RAIL_Y = 54;
const PRINT_WIDTH = 125;
const PRINT_HEIGHT = 166;
const UNDER_HANGER = -5;
const BORDER = 5;
// The rail, the hanger and the print with its border: the piece's whole height.
const TOP_HEIGHT =
  RAIL_Y -
  HANG_PIVOT +
  (HANGER_HEIGHT * HANG_WIDTH) / HANGER_WIDTH +
  UNDER_HANGER +
  PRINT_HEIGHT +
  2 * BORDER;

type Props = {
  // The kind picks the hanger; a piece whose kind isn't known gets a coat hanger.
  piece: Pick<Item, 'photoUrl' | 'cutoutUrl'> & { category?: Item['category'] };
  headers: Record<string, string> | undefined;
  // Not in her closet yet: a dashed hanger and a white-bordered print. Hers: a bare cut-out on a
  // solid one (docs/design.md, "Cut-outs vs prints").
  dashed: boolean;
  label: string;
};

// While the looks are put together (decided 2026-11-09, prototype
// `~/Desktop/closet/wrinkle-lab/design-wear-with-upload`, direction C): the piece hangs alone in the
// middle of the top rail, her closet goes past on the rail below, and what's happening is said under
// it. The tag runs on the lower rail only, so there's still one sign of waiting.
export function ComposingStage({ piece, headers, dashed, label }: Props) {
  // A bare hook doesn't reach down to a print, so that kind gets its clip (as on the pick screen).
  const hanger = piece.category ? HANGERS[piece.category] : 'coat';
  const kind = hanger === 'hook' ? 'print' : hanger;
  return (
    <Animated.View
      style={styles.stage}
      entering={FadeIn.duration(durations.state)}
      exiting={FadeOut.duration(durations.state)}
    >
      <View
        style={[styles.top, { pointerEvents: 'none' }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <RailLine style={styles.rail} />
        <View style={styles.hung}>
          <Hanger kind={kind} dashed={dashed} width={HANG_WIDTH} />
          {dashed ? (
            <View style={[styles.print, cutoutShadow('hanging')]}>
              <BarePiece item={piece} headers={headers} style={styles.photo} />
            </View>
          ) : (
            <BarePiece item={piece} headers={headers} style={[styles.photo, styles.bare]} />
          )}
        </View>
      </View>
      <ClosetBelt style={styles.belt} />
      <View accessible accessibilityRole="progressbar" accessibilityLabel={label}>
        <ComposingSteps style={styles.steps} />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    paddingBottom: 24,
  },
  top: {
    height: TOP_HEIGHT,
  },
  rail: {
    position: 'absolute',
    top: RAIL_Y,
    start: 0,
    end: 0,
  },
  hung: {
    position: 'absolute',
    top: RAIL_Y - HANG_PIVOT,
    start: 0,
    end: 0,
    alignItems: 'center',
  },
  // A piece not in the closet yet is a white-bordered print (docs/design.md).
  print: {
    marginTop: UNDER_HANGER,
    borderWidth: BORDER,
    borderColor: colors.paper,
    backgroundColor: colors.paper,
  },
  photo: {
    width: PRINT_WIDTH,
    height: PRINT_HEIGHT,
  },
  // Hers: no border, so it sits where the print's photo would.
  bare: {
    marginTop: UNDER_HANGER + BORDER,
    marginBottom: BORDER,
  },
  belt: {
    marginTop: 56,
  },
  steps: {
    marginTop: 56,
    paddingHorizontal: 24,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    color: colors.textSecondary,
  },
});

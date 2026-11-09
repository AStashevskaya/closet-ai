import type { LookItem } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { BarePiece } from '@/components/bare-piece';
import { cutoutShadow } from '@/components/cutout-shadow';
import {
  Hanger,
  HANGER_PIVOT_Y,
  HANGER_WIDTH,
  HANGERS,
  type HangerKind,
} from '@/components/hanger';
import { PressableScale } from '@/components/pressable-scale';
import { RailLine } from '@/components/rail-line';
import { useClosetPieces } from '@/lib/closet-pieces';
import { arrive, CSS_EASE_OUT, durations, EASE_OUT, STAGGER_STEP } from '@/motion';
import { LookCrop } from '@/screens/add-look/look-crop';
import { colors, fonts } from '@/theme';

// Where the screen is. `failed` also covers nothing found, and a limit reached once there's a photo.
export type RailPhase = 'empty' | 'finding' | 'picking' | 'chosen' | 'failed';

// Read once: switching to or from Hebrew reloads the app (src/lib/language.ts).
const DIRECTION = I18nManager.isRTL ? -1 : 1;

// The rail under the header, how far it moves down and how tall the stage is in each phase: the
// words under the stage follow its height. From the prototype, direction C.
const RAIL_Y = 20;
const DROP: Record<RailPhase, number> = {
  empty: 0,
  failed: 0,
  finding: 100,
  picking: 100,
  chosen: 100,
};
const STAGE: Record<RailPhase, number> = {
  empty: 246,
  failed: 246,
  finding: 400,
  picking: 348,
  chosen: 348,
};

const HANG_WIDTH = 64;
// How far the hook's point on the rail is from the top of a hanger this wide.
const HANG_PIVOT = (HANGER_PIVOT_Y * HANG_WIDTH) / HANGER_WIDTH;
const HANG_TOP = RAIL_Y - HANG_PIVOT;
// The print and the piece under a hanger reach up into it a little, as on the rails.
const UNDER_HANGER = -5;

// The empty place in the middle, and how much the print grows while the piece is looked for.
const MAIN_WIDTH = 160;
const FRAME_WIDTH = 138;
const FRAME_HEIGHT = 186;
const FRAME_GROWN = 1.3;

// Her pieces either side of it, from the centre along the reading direction: the outer two are
// cropped by the screen's edges. Filled from the inside out, starting on the start side.
const SIDE_SLOT = 128;
const SIDE_OFFSETS = [-121, 121, -197, 199];
const SIDE_LEAVES = 160;

// A piece found on the photo. Three fit on most phones; more scroll along the rail, as her closet's
// rails do, with the next one showing at the edge.
const FOUND_SLOT = 112;
const FOUND_WIDTH = 96;
const FOUND_HEIGHT = 128;
const CHOSEN_GROWN = 1.3;
// The hanger, a print grown by CHOSEN_GROWN and two lines of a name.
const FOUND_ROW_HEIGHT = 226;

// One swing, then it settles (as "Hang it up" does): how far in degrees, and how long in ms.
const SWING: [number, number][] = [
  [5, 275],
  [-2.6, 330],
  [1, 275],
  [0, 220],
];

// How something eases to its new place; with Reduce Motion it's simply there.
function useEase() {
  const reduced = useReducedMotion();
  return (duration: number) => ({
    transitionDuration: reduced ? 0 : duration,
    transitionTimingFunction: CSS_EASE_OUT,
  });
}

type Props = {
  phase: RailPhase;
  // The photo; none until one is picked.
  uri?: string;
  aspect?: number;
  items: LookItem[];
  // Which of the items was tapped.
  chosen: number | null;
  onChoose: (index: number) => void;
};

// The stage of "what do I wear this with?" (decided 2026-11-09, prototype
// `~/Desktop/closet/wrinkle-lab/design-wear-with-upload`, direction C "Пустая вешалка"): room made
// on her own rail, an empty dashed hanger between her pieces, and the photo hangs on it. One layout
// in every phase (docs/design.md, "Waiting"): the rail and the print are never remounted, only moved.
export function PickRail({ phase, uri, aspect, items, chosen, onChoose }: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const ease = useEase();
  const { width } = useWindowDimensions();
  const { pieces, headers } = useClosetPieces(SIDE_OFFSETS.length);
  const centre = width / 2;

  const hasPhoto = uri !== undefined;
  const choosing = phase === 'picking' || phase === 'chosen';

  const swing = useSharedValue(0);
  useEffect(() => {
    if (phase !== 'finding' || reduced) return;
    const [first, ...rest] = SWING.map(([angle, duration]) =>
      withTiming(angle * DIRECTION, { duration, easing: EASE_OUT }),
    );
    swing.set(withSequence(first!, ...rest));
    return () => {
      cancelAnimation(swing);
      swing.set(0);
    };
  }, [phase, reduced, swing]);
  const swinging = useAnimatedStyle(() => ({ transform: [{ rotate: `${swing.get()}deg` }] }));

  return (
    <Animated.View
      style={[
        styles.stage,
        { height: STAGE[phase], transitionProperty: 'height', ...ease(durations.enter) },
      ]}
    >
      <Animated.View
        style={[
          styles.moving,
          {
            transform: [{ translateY: DROP[phase] }],
            transitionProperty: 'transform',
            ...ease(durations.enter),
          },
        ]}
      >
        {pieces.map((piece, index) => {
          const offset = SIDE_OFFSETS[index]!;
          return (
            <Animated.View
              key={piece.id}
              testID="closet-piece"
              style={[styles.side, { start: centre + offset - SIDE_SLOT / 2 }]}
              entering={arrive.delay(index * STAGGER_STEP)}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              {/* Off the rail to their own side; transforms aren't mirrored, so flipped in Hebrew. */}
              <Animated.View
                style={[
                  styles.hung,
                  {
                    opacity: choosing ? 0 : 1,
                    transform: [
                      { translateX: choosing ? Math.sign(offset) * SIDE_LEAVES * DIRECTION : 0 },
                    ],
                    transitionProperty: ['opacity', 'transform'],
                    ...ease(durations.enter),
                  },
                ]}
              >
                <Hanger kind={HANGERS[piece.category]} width={HANG_WIDTH} />
                <BarePiece item={piece} headers={headers} style={styles.sideImage} />
              </Animated.View>
            </Animated.View>
          );
        })}

        <Animated.View
          style={[
            styles.main,
            { start: centre - MAIN_WIDTH / 2 },
            { opacity: choosing ? 0 : 1, transitionProperty: 'opacity', ...ease(durations.leave) },
          ]}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Animated.View style={[styles.hung, styles.mainTurn, swinging]}>
            <Hanger kind="coat" dashed width={HANG_WIDTH} />
            <Animated.View
              style={[
                styles.frame,
                {
                  transform: [{ scale: phase === 'finding' ? FRAME_GROWN : 1 }],
                  transitionProperty: 'transform',
                  ...ease(durations.enter),
                },
              ]}
            >
              <Animated.View
                testID="empty-print"
                style={[
                  styles.frameLayer,
                  styles.dashed,
                  {
                    opacity: hasPhoto ? 0 : 1,
                    transitionProperty: 'opacity',
                    ...ease(durations.state),
                  },
                ]}
              >
                <Text style={styles.caption} maxFontSizeMultiplier={1.2}>
                  {t('wearWith.blank')}
                </Text>
              </Animated.View>
              <Animated.View
                style={[
                  styles.frameLayer,
                  styles.print,
                  cutoutShadow('hanging'),
                  {
                    opacity: hasPhoto ? 1 : 0,
                    transitionProperty: 'opacity',
                    ...ease(durations.leave),
                  },
                ]}
              >
                {hasPhoto && (
                  <Image
                    source={{ uri }}
                    style={styles.photo}
                    contentFit="cover"
                    transition={250}
                    accessibilityIgnoresInvertColors
                    testID="print-photo"
                  />
                )}
              </Animated.View>
            </Animated.View>
          </Animated.View>
        </Animated.View>

        {choosing && hasPhoto && aspect !== undefined && (
          <ScrollView
            horizontal
            style={styles.found}
            contentContainerStyle={styles.foundRow}
            showsHorizontalScrollIndicator={false}
            scrollEnabled={phase === 'picking'}
          >
            {items.map((item, index) => (
              <FoundPiece
                key={`${uri}-${index}`}
                item={item}
                index={index}
                uri={uri}
                aspect={aspect}
                chosen={chosen === index}
                leaving={chosen !== null && chosen !== index}
                centre={centre}
                onChoose={onChoose}
              />
            ))}
          </ScrollView>
        )}

        {/* Over the hooks, with the tag over everything: the one sign of waiting. */}
        <RailLine waiting={phase === 'finding' || phase === 'chosen'} style={styles.rail} />
      </Animated.View>
    </Animated.View>
  );
}

// A print hangs from what reaches down to it: a bare hook doesn't, so that kind gets its clip.
function printHanger(item: LookItem): HangerKind {
  const kind = HANGERS[item.category];
  return kind === 'hook' ? 'print' : kind;
}

// A piece found on the photo, a print on a dashed hanger (not hers), to tap. Once tapped it moves
// to the middle and grows while the others go.
function FoundPiece({
  item,
  index,
  uri,
  aspect,
  chosen,
  leaving,
  centre,
  onChoose,
}: {
  item: LookItem;
  index: number;
  uri: string;
  aspect: number;
  chosen: boolean;
  leaving: boolean;
  centre: number;
  onChoose: (index: number) => void;
}) {
  const ease = useEase();
  const slot = useRef<ComponentRef<typeof View>>(null);
  // How far it is from the middle of the screen, measured when tapped as the row may have scrolled.
  // Window coordinates and transforms are both physical, so this holds in Hebrew too.
  const [toCentre, setToCentre] = useState(0);
  const tapped = () => {
    slot.current?.measureInWindow((x, _y, slotWidth) => setToCentre(centre - (x + slotWidth / 2)));
    onChoose(index);
  };

  return (
    <Animated.View style={styles.foundSlot} entering={arrive.delay(index * STAGGER_STEP)}>
      <View ref={slot} collapsable={false}>
        <Animated.View
          style={[
            styles.foundTurn,
            {
              opacity: leaving ? 0 : 1,
              transform: [
                { translateX: chosen ? toCentre : 0 },
                { scale: chosen ? CHOSEN_GROWN : 1 },
              ],
              transitionProperty: ['opacity', 'transform'],
              ...ease(durations.enter),
            },
          ]}
          accessibilityElementsHidden={leaving}
          importantForAccessibility={leaving ? 'no-hide-descendants' : 'auto'}
        >
          <PressableScale
            style={styles.hung}
            onPress={tapped}
            disabled={chosen || leaving}
            accessibilityRole="button"
            accessibilityLabel={item.name}
            testID="found-piece"
          >
            <Hanger kind={printHanger(item)} dashed width={HANG_WIDTH} />
            <View style={[styles.foundPrint, cutoutShadow('hanging')]}>
              <LookCrop uri={uri} aspect={aspect} box={item.box} style={styles.foundCrop} />
            </View>
            <Animated.Text
              style={[
                styles.foundName,
                {
                  opacity: chosen ? 0 : 1,
                  transitionProperty: 'opacity',
                  ...ease(durations.state),
                },
              ]}
              numberOfLines={2}
            >
              {item.name}
            </Animated.Text>
          </PressableScale>
        </Animated.View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  stage: {
    alignSelf: 'stretch',
  },
  moving: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
  },
  rail: {
    position: 'absolute',
    top: RAIL_Y,
    start: 0,
    end: 0,
  },
  hung: {
    alignItems: 'center',
  },
  side: {
    position: 'absolute',
    top: HANG_TOP,
    width: SIDE_SLOT,
  },
  sideImage: {
    width: 110,
    height: 132,
    marginTop: UNDER_HANGER,
  },
  main: {
    position: 'absolute',
    top: HANG_TOP,
    width: MAIN_WIDTH,
  },
  // Swings around the hook, on the rail.
  mainTurn: {
    transformOrigin: `50% ${HANG_PIVOT}px`,
  },
  // Grows from its top edge, staying on the hanger.
  frame: {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    marginTop: UNDER_HANGER,
    transformOrigin: '50% 0%',
  },
  frameLayer: {
    ...StyleSheet.absoluteFill,
  },
  // Not hers yet: an empty dashed print, no paper.
  dashed: {
    borderWidth: 1.4,
    borderStyle: 'dashed',
    borderColor: colors.textMuted,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  caption: {
    fontFamily: fonts.hand,
    fontSize: 18,
    lineHeight: 22,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  // A piece not in the closet yet is a white-bordered print (docs/design.md).
  print: {
    borderWidth: 6,
    borderColor: colors.paper,
    backgroundColor: colors.paper,
  },
  photo: {
    flex: 1,
  },
  found: {
    position: 'absolute',
    top: HANG_TOP,
    start: 0,
    end: 0,
    height: FOUND_ROW_HEIGHT,
  },
  // In the middle when they fit; from the start edge when they run on.
  foundRow: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  foundSlot: {
    width: FOUND_SLOT,
  },
  // Grows from the hook, staying on the rail.
  foundTurn: {
    transformOrigin: `50% ${HANG_PIVOT}px`,
  },
  foundPrint: {
    marginTop: UNDER_HANGER,
    borderWidth: 4,
    borderColor: colors.paper,
    backgroundColor: colors.paper,
  },
  foundCrop: {
    width: FOUND_WIDTH,
    height: FOUND_HEIGHT,
  },
  foundName: {
    marginTop: 8,
    paddingHorizontal: 4,
    fontFamily: fonts.body,
    fontSize: 12.5,
    lineHeight: 16,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

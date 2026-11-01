import type { ItemBox, LookItem } from '@closet-ai/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Line, Path } from 'react-native-svg';

import { loopPoints, seedFrom, smoothPath } from '@/components/hand-drawn';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

// "Photos with marks on them" (docs/design.md, decided 2026-10-31, prototype
// `~/Desktop/closet/wrinkle-lab/design-adding`, the selfie screen, direction "Выбрано"): each
// piece found is looped by hand in two strokes (white, then the thread) so the loop holds on
// light and dark photos; a piece too small for a loop gets a bead; each has a handwritten label
// tied to it by a short thread. A piece left out: its loop goes dashed and its label is struck.

// A rectangle on the stage, in points from its top left corner.
export type Rect = { left: number; top: number; width: number; height: number };
type Size = { width: number; height: number };

// Where the photo sits on the stage: full width, as tall as it is for that width, up to twice the
// width (a very tall screenshot is shown whole and centred). Units: the photo is `aspect` wide
// and 1 high, `scale` points per unit.
const MAX_TALL = 2;
export function stageOf(aspect: number, width: number) {
  const height = Math.min(width / aspect, width * MAX_TALL);
  const scale = Math.min(width / aspect, height);
  return { width, height, scale, left: (width - aspect * scale) / 2, top: (height - scale) / 2 };
}
export type Stage = ReturnType<typeof stageOf>;

// A piece's box on the stage.
export function rectOf(box: ItemBox, aspect: number, stage: Stage): Rect {
  return {
    left: stage.left + box.xMin * aspect * stage.scale,
    top: stage.top + box.yMin * stage.scale,
    width: (box.xMax - box.xMin) * aspect * stage.scale,
    height: (box.yMax - box.yMin) * stage.scale,
  };
}

// The loop runs a little outside the piece, kept on the stage.
const LOOP_PAD = 6;
const EDGE = 2;
// Smaller than this either way, a piece gets a bead: a loop would be a scribble.
const SMALL = 44;
const BEAD = 18;

export type Mark = { index: number; kind: 'loop' | 'bead'; at: Rect };

// The mark for each piece, largest first, so a smaller piece over a larger one (a bag over a
// shirt) is drawn, and caught by a tap, on top of it.
export function marksOf(items: LookItem[], aspect: number, stage: Stage): Mark[] {
  return items
    .map((item, index): Mark => {
      const r = rectOf(item.box, aspect, stage);
      if (r.width < SMALL || r.height < SMALL) {
        const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        return {
          index,
          kind: 'bead',
          at: { left: centre.x - BEAD / 2, top: centre.y - BEAD / 2, width: BEAD, height: BEAD },
        };
      }
      const left = Math.max(EDGE, r.left - LOOP_PAD);
      const top = Math.max(EDGE, r.top - LOOP_PAD);
      const right = Math.min(stage.width - EDGE, r.left + r.width + LOOP_PAD);
      const bottom = Math.min(stage.height - EDGE, r.top + r.height + LOOP_PAD);
      return { index, kind: 'loop', at: { left, top, width: right - left, height: bottom - top } };
    })
    .sort((a, b) => b.at.width * b.at.height - a.at.width * a.at.height);
}

// Room a label keeps from the stage's edges and from other labels, and its distance from its mark.
const MARGIN = 8;
const SPACE_X = 6;
const SPACE_Y = 4;
const TIE = 10;

export type Placed = { left: number; top: number; anchor: { x: number; y: number } };

// Where each mark's label goes: largest mark first, each in the first free spot around it (above,
// beside, below, inside), on the stage and clear of the labels placed before it. With no free
// spot it goes above, pushed onto the stage. Returned by the piece's index.
export function placeLabels(marks: Mark[], sizes: Size[], stage: Stage): Placed[] {
  const placed: (Placed & Size)[] = [];
  const out: Placed[] = [];
  for (const { index, at } of marks) {
    const { width, height } = sizes[index]!;
    const cx = at.left + at.width / 2;
    const cy = at.top + at.height / 2;
    const spots: Placed[] = [
      { left: cx - width / 2, top: at.top - height - TIE, anchor: { x: cx, y: at.top } },
      {
        left: at.left + at.width + TIE + 2,
        top: cy - height / 2,
        anchor: { x: at.left + at.width, y: cy },
      },
      { left: at.left - width - TIE - 2, top: cy - height / 2, anchor: { x: at.left, y: cy } },
      {
        left: cx - width / 2,
        top: at.top + at.height + TIE,
        anchor: { x: cx, y: at.top + at.height },
      },
      { left: cx - width / 2, top: cy - height / 2, anchor: { x: cx, y: cy } },
    ];
    const free = (spot: Placed) =>
      spot.left >= MARGIN &&
      spot.left + width <= stage.width - MARGIN &&
      spot.top >= MARGIN &&
      spot.top + height <= stage.height - MARGIN &&
      !placed.some(
        (other) =>
          spot.left < other.left + other.width + SPACE_X &&
          other.left < spot.left + width + SPACE_X &&
          spot.top < other.top + other.height + SPACE_Y &&
          other.top < spot.top + height + SPACE_Y,
      );
    const first = spots[0]!;
    const spot = spots.find(free) ?? {
      ...first,
      left: Math.max(MARGIN, Math.min(stage.width - MARGIN - width, first.left)),
      top: Math.max(MARGIN, Math.min(stage.height - MARGIN - height, first.top)),
    };
    placed.push({ ...spot, width, height });
    out[index] = spot;
  }
  return out;
}

type Props = {
  items: LookItem[];
  aspect: number;
  stage: Stage;
  // Indexes of the pieces to add; the others are left out.
  picked: Set<number>;
  onToggle: (index: number) => void;
};

// When the marks come, after the photo is read: loops one after another, then their threads and
// labels, as in the prototype. The screen doesn't enter again; only what's new fades in.
const MARK_AT = 300;
const MARK_STEP = 180;
const LABEL_AT = 600;
const LINE = 1.3;
const HALO = 3.4;

// The marks over the photo, laid out left-to-right whatever the language: they sit on photo
// pixels, which are never mirrored. The labels are the pieces' checkboxes for screen readers and
// switch control, read in the order the pieces were found; the loops, beads and threads repeat
// them and are hidden from assistive tech.
export function Marks({ items, aspect, stage, picked, onToggle }: Props) {
  const { t } = useTranslation();
  const marks = marksOf(items, aspect, stage);
  // Each label's size, measured once off-screen before the labels are placed.
  const [sizes, setSizes] = useState<(Size | undefined)[]>(() => items.map(() => undefined));
  const measured = sizes.every(Boolean);
  const labels = measured ? placeLabels(marks, sizes as Size[], stage) : null;
  // Where each piece's mark is in the drawing order, for its entrance.
  const order = new Map(marks.map((mark, k) => [mark.index, k]));

  return (
    <View style={[StyleSheet.absoluteFill, styles.ltr]} pointerEvents="box-none">
      {marks.map(({ index, kind, at }, k) => {
        const on = picked.has(index);
        return (
          <Animated.View
            key={index}
            style={[styles.mark, at]}
            entering={FadeIn.duration(durations.enter).delay(MARK_AT + k * MARK_STEP)}
          >
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => onToggle(index)}
              hitSlop={kind === 'bead' ? (44 - BEAD) / 2 : 0}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
              testID={`${kind}-${index}`}
            >
              {kind === 'loop' ? (
                <Loop
                  width={at.width}
                  height={at.height}
                  seed={seedFrom(items[index]!.name) + index}
                  on={on}
                />
              ) : (
                <View style={[styles.bead, !on && styles.dashed]}>
                  <View style={[styles.beadInside, !on && styles.beadOff]} />
                </View>
              )}
            </Pressable>
          </Animated.View>
        );
      })}

      {labels && (
        <Animated.View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          entering={FadeIn.duration(durations.enter).delay(LABEL_AT)}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Svg width={stage.width} height={stage.height}>
            {labels.map(({ left, top, anchor }, index) => {
              const size = sizes[index]!;
              const from = { x: left + size.width / 2, y: top + size.height / 2 };
              const dash = picked.has(index) ? undefined : [3, 4];
              return [HALO - 1, 1].map((width, layer) => (
                <Line
                  key={`${index}-${layer}`}
                  x1={from.x}
                  y1={from.y}
                  x2={anchor.x}
                  y2={anchor.y}
                  stroke={layer === 0 ? colors.paper : colors.text}
                  strokeWidth={width}
                  strokeDasharray={dash}
                  strokeLinecap="round"
                />
              ));
            })}
          </Svg>
        </Animated.View>
      )}

      {labels &&
        items.map((item, index) => {
          const on = picked.has(index);
          return (
            <Animated.View
              key={index}
              style={[styles.label, { left: labels[index]!.left, top: labels[index]!.top }]}
              entering={FadeIn.duration(durations.enter).delay(
                LABEL_AT + (order.get(index) ?? 0) * MARK_STEP,
              )}
            >
              <Pressable
                style={[styles.labelPress, { maxWidth: stage.width - MARGIN * 2 }]}
                onPress={() => onToggle(index)}
                hitSlop={8}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={item.name}
                accessibilityHint={t(`categories.${item.category}`)}
              >
                <Text style={[styles.labelText, !on && styles.labelOff]} numberOfLines={1}>
                  {item.name}
                </Text>
              </Pressable>
            </Animated.View>
          );
        })}

      {/* Measured out of sight, then placed: a label's size decides where it fits. */}
      {!measured && (
        <View
          style={styles.measure}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {items.map((item, index) => (
            <View
              key={index}
              style={[styles.labelPress, { maxWidth: stage.width - MARGIN * 2 }]}
              testID="measure-label"
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout;
                setSizes((old) => old.map((size, k) => (k === index ? { width, height } : size)));
              }}
            >
              <Text style={styles.labelText} numberOfLines={1}>
                {item.name}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

// A hand-drawn loop around a piece, in two strokes: a wide white one under the thread.
function Loop({
  width,
  height,
  seed,
  on,
}: {
  width: number;
  height: number;
  seed: number;
  on: boolean;
}) {
  const pad = HALO / 2 + 1;
  const d = smoothPath(loopPoints(width - pad * 2, height - pad * 2, seed));
  const dash = on ? undefined : [5, 5];
  return (
    <Svg width={width} height={height}>
      {[
        { stroke: colors.paper, width: HALO },
        { stroke: colors.text, width: LINE },
      ].map((layer) => (
        <Path
          key={layer.stroke}
          d={d}
          transform={`translate(${pad} ${pad})`}
          fill="none"
          stroke={layer.stroke}
          strokeWidth={layer.width}
          strokeDasharray={dash}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </Svg>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  // The photo's own directions: left is left in Hebrew too.
  ltr: {
    direction: 'ltr',
  },
  mark: {
    position: 'absolute',
  },
  // A thread ring around a white one, so the bead holds on any photo, as the loops do.
  bead: {
    width: BEAD,
    height: BEAD,
    borderRadius: BEAD / 2,
    borderWidth: 1.2,
    borderColor: colors.text,
  },
  beadInside: {
    flex: 1,
    borderRadius: BEAD / 2,
    borderWidth: 2,
    borderColor: colors.paper,
    backgroundColor: colors.bead,
  },
  // Left out: hollow and dashed, as everything that won't be hers.
  dashed: {
    borderStyle: 'dashed',
  },
  beadOff: {
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  label: {
    position: 'absolute',
  },
  labelPress: {
    minHeight: 28,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.paper,
    justifyContent: 'center',
  },
  labelText: {
    fontFamily: fonts.hand,
    fontSize: 16,
    color: colors.text,
  },
  labelOff: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  measure: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0,
    alignItems: 'flex-start',
  },
});

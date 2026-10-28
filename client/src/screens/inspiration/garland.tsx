import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { cutoutShadow } from '@/components/cutout-shadow';
import { HandDrawn, seedFrom } from '@/components/hand-drawn';
import { PressableScale } from '@/components/pressable-scale';
import { absoluteUrl } from '@/lib/api';
import { rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

export type Point = [number, number];

// A look on the garland: a saved one, or a photo still on its way up.
export type GarlandLook =
  | { kind: 'saved'; key: string; url: string; createdAt: string }
  | { kind: 'pending'; key: string; uri: string };

// Where the thread ties on: this far above the picture, at its middle.
export const TIE_ABOVE = 14;
const KNOT = { w: 30, h: 28 };

type Props = {
  looks: GarlandLook[];
  // The new ones hang loose (no hearts): the stylist hasn't read them yet.
  loose: boolean;
  headers?: Record<string, string>;
  delay?: number;
  // Each look's tie point, in the garland's own coordinates, once they're laid out.
  onTies: (ties: Point[]) => void;
  onLongPress: (key: string) => void;
};

// The looks hang one under another, alternating sides, a little crooked, like prints on a line
// (Inspiration, The Thread, decided 2026-10-28). The thread itself is drawn by the screen, which
// knows where every garland is; here each look says where it ties on.
export function Garland({ looks, loose, headers, delay = 0, onTies, onLongPress }: Props) {
  const [frames, setFrames] = useState<Record<string, { x: number; y: number; w: number }>>({});

  function laidOut(key: string, frame: { x: number; y: number; w: number }) {
    setFrames((old) => {
      const before = old[key];
      if (before && before.x === frame.x && before.y === frame.y && before.w === frame.w)
        return old;
      return { ...old, [key]: frame };
    });
  }

  // Once every look has its place, the screen gets the tie points (again whenever one moves).
  useEffect(() => {
    if (!looks.every((look) => frames[look.key])) return;
    onTies(
      looks.map((look) => {
        const f = frames[look.key]!;
        return [f.x + f.w / 2, f.y - TIE_ABOVE];
      }),
    );
  }, [frames, looks, onTies]);

  return (
    <View style={styles.garland}>
      {looks.map((look, index) => (
        <Animated.View
          key={look.key}
          entering={rise.delay(delay + Math.min(index, 6) * STAGGER_STEP)}
          style={[styles.look, index % 2 === 1 && styles.end]}
          onLayout={(event) => {
            const { x, y, width } = event.nativeEvent.layout;
            laidOut(look.key, { x, y, w: width });
          }}
        >
          <SavedLook
            look={look}
            index={index}
            loose={loose}
            headers={headers}
            knotDelay={delay + 500 + Math.min(index, 6) * 150}
            ready={Boolean(frames[look.key])}
            onLongPress={onLongPress}
          />
        </Animated.View>
      ))}
    </View>
  );
}

function SavedLook({
  look,
  index,
  loose,
  headers,
  knotDelay,
  ready,
  onLongPress,
}: {
  look: GarlandLook;
  index: number;
  loose: boolean;
  headers?: Record<string, string>;
  knotDelay: number;
  ready: boolean;
  onLongPress: (key: string) => void;
}) {
  const { t, i18n } = useTranslation();
  // Every other one leans the other way; mirrored in RTL with the sides.
  const lean = [-1.4, 0, 1.1, 0][index % 4]! * (I18nManager.isRTL ? -1 : 1);
  const picture =
    look.kind === 'pending' ? (
      <Image source={{ uri: look.uri }} style={[styles.image, styles.pending]} contentFit="cover" />
    ) : (
      headers && (
        <Image
          source={{ uri: absoluteUrl(look.url), headers }}
          style={styles.image}
          contentFit="cover"
          // Screenshots: past the phone's status bar and the app's header, to the look itself.
          contentPosition={{ top: '38%', left: '50%' }}
          transition={300}
          accessibilityIgnoresInvertColors
        />
      )
    );

  return (
    <>
      <PressableScale
        style={[styles.frame, cutoutShadow('flat'), { transform: [{ rotate: `${lean}deg` }] }]}
        onLongPress={look.kind === 'saved' ? () => onLongPress(look.key) : undefined}
        disabled={look.kind === 'pending'}
        accessibilityRole="image"
        accessibilityLabel={
          look.kind === 'saved'
            ? t('inspiration.lookLabel', { date: dateOf(look.createdAt, t, i18n.language) })
            : t('inspiration.saving')
        }
        accessibilityActions={
          look.kind === 'saved' ? [{ name: 'delete', label: t('inspiration.delete') }] : undefined
        }
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onLongPress(look.key);
        }}
      >
        {picture}
      </PressableScale>
      {/* Taken to heart: a learned look is tied on with a little heart; a new one just hangs. */}
      {!loose && (
        <View style={styles.knot}>
          <HandDrawn shape="heart" drawn={ready} seed={seedFrom(look.key)} fill delay={knotDelay} />
        </View>
      )}
      {/* Read with the picture's label, not again on its own. */}
      <Text
        style={[styles.date, index % 2 === 1 && styles.dateEnd]}
        accessibilityElementsHidden
        importantForAccessibility="no"
      >
        {look.kind === 'saved' ? dateOf(look.createdAt, t, i18n.language) : t('inspiration.saving')}
      </Text>
    </>
  );
}

// "today", "yesterday", else "26 Oct": when she saved it, in her hand.
function dateOf(
  iso: string,
  t: (key: 'inspiration.today' | 'inspiration.yesterday') => string,
  lang: string,
) {
  const day = (date: Date) =>
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(new Date()) - day(new Date(iso))) / 86_400_000);
  if (days === 0) return t('inspiration.today');
  if (days === 1) return t('inspiration.yesterday');
  return new Date(iso).toLocaleDateString(lang, { day: 'numeric', month: 'short' });
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  garland: {
    paddingHorizontal: 20,
    paddingTop: 34,
    gap: 46,
  },
  // Big: 60% of the width, so a look reads as a picture, not a thumbnail.
  look: {
    width: '60%',
  },
  end: {
    marginStart: 'auto',
  },
  frame: {
    aspectRatio: 3 / 4,
    backgroundColor: colors.hero,
  },
  image: {
    flex: 1,
  },
  pending: {
    opacity: 0.45,
  },
  knot: {
    position: 'absolute',
    top: -TIE_ABOVE - KNOT.h / 2,
    start: '50%',
    width: KNOT.w,
    height: KNOT.h,
    marginStart: -KNOT.w / 2,
  },
  // The date sits on the side the thread doesn't leave from.
  date: {
    marginTop: 8,
    fontFamily: fonts.hand,
    fontSize: 19,
    lineHeight: 24,
    color: colors.text,
    textAlign: 'left',
  },
  dateEnd: {
    textAlign: 'right',
  },
});

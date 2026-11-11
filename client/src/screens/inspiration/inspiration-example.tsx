import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { HandDrawn } from '@/components/hand-drawn';
import { arrive, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

// The owner's own photo (2026-11-11), shipped with the app.
const PHOTO = require('../../../assets/example/inspiration.jpg');
const PHOTO_W = 150;
const PHOTO_H = 200;
// The white border of a print.
const BORDER = 5;
// The print hangs this far below the garland's wire.
const HANG = 34;
// Where the notes start, from the start edge.
const NOTES_AT = PHOTO_W + 30;
// What each note points at on the photo (as fractions of it) and where the note sits (its top).
const NOTES = [
  { key: 'hat', at: { x: 0.36, y: 0.07 }, top: 0 },
  { key: 'blazer', at: { x: 0.44, y: 0.42 }, top: 76 },
  { key: 'boots', at: { x: 0.28, y: 0.9 }, top: 152 },
] as const;
const HEIGHT = HANG + PHOTO_H + 2 * BORDER + 8;

// What Inspiration does, before she has saved a look (decided 2026-11-11, prototype
// `~/Desktop/closet/wrinkle-lab/design-empty`): Inspiration learns her taste, it doesn't recreate
// the look, so the example is a look being read. A saved look tied to the garland with a heart, as
// a learned one is, and three notes by hand, each tied by a thread to what it points at. Its words
// are for screen readers in one label; the picture and the threads are decoration.
export function InspirationExample() {
  const { t } = useTranslation();
  const notes = NOTES.map((note) => t(`inspiration.example.notes.${note.key}`));

  return (
    <Animated.View
      style={styles.example}
      entering={arrive}
      testID="inspiration-example"
      accessible
      accessibilityLabel={[t('inspiration.example.label'), ...notes].join(', ')}
    >
      <View
        style={StyleSheet.absoluteFill}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {/* The wire and the threads, drawn from the start edge and mirrored in RTL. */}
        <Svg
          width="100%"
          height={HEIGHT}
          style={I18nManager.isRTL && styles.mirrored}
          viewBox={`0 0 320 ${HEIGHT}`}
          preserveAspectRatio="xMinYMin meet"
        >
          <Path d="M-20 6 Q90 34 640 -10" fill="none" stroke={colors.text} strokeWidth={1.2} />
          {NOTES.map((note) => {
            const x = BORDER + note.at.x * PHOTO_W;
            const y = HANG + BORDER + note.at.y * PHOTO_H;
            const end = note.top + 14;
            return (
              <Path
                key={note.key}
                d={`M${x} ${y} C${x + 40} ${y} ${NOTES_AT - 30} ${end} ${NOTES_AT - 4} ${end}`}
                fill="none"
                stroke={colors.text}
                strokeWidth={1.1}
              />
            );
          })}
          {NOTES.map((note) => (
            <Circle
              key={`dot-${note.key}`}
              cx={BORDER + note.at.x * PHOTO_W}
              cy={HANG + BORDER + note.at.y * PHOTO_H}
              r={4}
              fill={colors.background}
              stroke={colors.text}
              strokeWidth={1.4}
            />
          ))}
        </Svg>
        <View style={styles.print}>
          <Image source={PHOTO} style={styles.photo} contentFit="cover" />
          <Text style={styles.stamp}>{t('styleIt.example.stamp')}</Text>
        </View>
        {/* Taken to heart: where the look is tied to the garland. */}
        <View style={styles.knot}>
          <HandDrawn shape="heart" drawn seed={7} fill delay={600} />
        </View>
        {notes.map((note, index) => (
          <Animated.Text
            key={NOTES[index]!.key}
            style={[styles.note, { top: HANG + NOTES[index]!.top }]}
            entering={arrive.delay((index + 2) * 2 * STAGGER_STEP)}
          >
            {note}
          </Animated.Text>
        ))}
      </View>
    </Animated.View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  example: {
    height: HEIGHT,
    marginHorizontal: 20,
    marginBottom: 12,
  },
  mirrored: {
    transform: [{ scaleX: -1 }],
  },
  // A look that isn't hers: a white-bordered print, a little tilted.
  print: {
    position: 'absolute',
    top: HANG,
    start: 0,
    width: PHOTO_W + 2 * BORDER,
    height: PHOTO_H + 2 * BORDER,
    padding: BORDER,
    backgroundColor: colors.paper,
    transform: [{ rotate: '-2deg' }],
    shadowColor: colors.text,
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  photo: {
    flex: 1,
  },
  stamp: {
    position: 'absolute',
    top: 8,
    start: 10,
    fontFamily: fonts.hand,
    fontSize: 18,
    color: colors.onAccent,
    transform: [{ rotate: '-6deg' }],
  },
  knot: {
    position: 'absolute',
    top: 4,
    start: (PHOTO_W + 2 * BORDER) / 2 - 15,
    width: 30,
    height: 28,
  },
  note: {
    position: 'absolute',
    start: NOTES_AT,
    end: 0,
    fontFamily: fonts.hand,
    fontSize: 20,
    lineHeight: 25,
    color: colors.textSecondary,
    textAlign: 'left',
  },
});

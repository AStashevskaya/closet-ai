import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import { Hanger } from '@/components/hanger';
import { useThreadMotion } from '@/components/thread-stops';
import { SIGN_BOX, SIGN_REACH, WaitingSign } from '@/components/waiting-sign';
import { durations, EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

import { CURTAIN_EDGE, STAGE_HEIGHT } from './curtain';

type Props = {
  // The screenshot once there is one, shown whole on her side.
  uri?: string;
  // A sign runs along the curtain's line.
  waiting?: boolean;
  // No line at all: nothing of hers to draw a curtain over.
  bare?: boolean;
  // Tapping the empty stage picks a screenshot, like the button under it.
  onPick?: () => void;
};

// Recreate before there's a result (decided 2026-11-02, prototype
// `~/Desktop/closet/wrinkle-lab/design-recreate-upload`, direction B): the curtain is there from the
// start. Empty, its line stands in the middle, a dashed print on her side and empty dashed hangers
// on yours say what will happen. With a screenshot the line moves to the far edge and yours goes.
// The result starts from that place (`Curtain`), so it's one frame, not a new screen. No handle
// here: there's nothing to drag yet.
// Decorative for screen readers: the text under it says the same.
export function UploadStage({ uri, waiting = false, bare = false, onPick }: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  // How far the line stands from yours' edge, as a share of the width.
  const fromEnd = useSharedValue(uri ? CURTAIN_EDGE : 0.5);
  const empty = !uri;

  useEffect(() => {
    const to = empty ? 0.5 : CURTAIN_EDGE;
    fromEnd.set(reduced ? to : withTiming(to, { duration: durations.settle, easing: EASE_OUT }));
  }, [empty, fromEnd, reduced]);

  const { run } = useThreadMotion(false, waiting);
  const line = useAnimatedStyle(() => ({ end: fromEnd.get() * width }));
  const sign = useAnimatedStyle(() => ({
    transform: [{ translateY: run.get() * (STAGE_HEIGHT - SIGN_REACH) }],
  }));

  return (
    <Pressable
      style={styles.stage}
      onLayout={(event) => setWidth(Math.round(event.nativeEvent.layout.width))}
      onPress={onPick}
      disabled={!onPick}
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      accessibilityElementsHidden
      testID="upload-stage"
    >
      {uri ? (
        <Animated.View style={StyleSheet.absoluteFill} entering={FadeIn.duration(durations.state)}>
          <Image
            source={{ uri }}
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
        </Animated.View>
      ) : (
        <Animated.View
          style={styles.panes}
          exiting={FadeOut.duration(durations.state)}
          testID="upload-empty"
        >
          <View style={styles.pane}>
            <View style={styles.print}>
              <Text style={styles.printText}>{t('want.hand')}</Text>
            </View>
          </View>
          <View style={[styles.pane, styles.hangers]}>
            <Hanger kind="coat" dashed />
            <Hanger kind="clip" dashed />
            <Hanger kind="hook" dashed />
          </View>
          <Text style={[styles.label, styles.labelYours]}>{t('want.yours')}</Text>
        </Animated.View>
      )}
      <Text style={[styles.label, styles.labelHers]}>{t('want.hers')}</Text>
      {!bare && (
        <Animated.View style={[styles.knife, line]} testID="upload-line">
          <View style={styles.line} />
          {waiting && (
            <Animated.View style={[styles.sign, sign]} testID="thread-waiting">
              <WaitingSign run={run} way="down" />
            </Animated.View>
          )}
        </Animated.View>
      )}
    </Pressable>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  stage: {
    marginHorizontal: -22,
    height: STAGE_HEIGHT,
    overflow: 'hidden',
    backgroundColor: colors.ground,
  },
  // A row follows the layout direction: in Hebrew hers is on the right, as on the curtain.
  panes: {
    ...StyleSheet.absoluteFill,
    flexDirection: 'row',
  },
  pane: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 30,
  },
  print: {
    width: '80%',
    height: 270,
    borderWidth: 1.4,
    borderStyle: 'dashed',
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 14,
    transform: [{ rotate: '-3deg' }],
  },
  printText: {
    fontFamily: fonts.hand,
    fontSize: 21,
    lineHeight: 25,
    color: colors.text,
    textAlign: 'center',
  },
  hangers: {
    gap: 76,
  },
  label: {
    position: 'absolute',
    top: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
    backgroundColor: colors.paper,
    fontFamily: fonts.displayLight,
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
  },
  labelHers: {
    start: 12,
  },
  labelYours: {
    end: 12,
  },
  knife: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 0,
  },
  line: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    start: -0.6,
    width: 1.2,
    backgroundColor: colors.text,
  },
  sign: {
    position: 'absolute',
    top: 0,
    start: -SIGN_BOX / 2,
    width: SIGN_BOX,
    height: SIGN_BOX,
  },
});

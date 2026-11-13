import { Image } from 'expo-image';
import { useEffect, useRef, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { AccessibilityInfo, I18nManager, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { cutoutShadow } from '@/components/cutout-shadow';
import { Hanger, HANGER_HEIGHT, HANGER_PIVOT_Y, HANGER_WIDTH } from '@/components/hanger';
import { Button, maison } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { durations, rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

// The example piece: a black camisole from the demo catalog (`server/seed/catalog`), shipped with
// the app for Style it's example, so the hint needs no network.
const PIECE = require('../../../assets/example/P004.webp');

// Sizes from the prototype's "before → after" (its 140 × 175 frames, a little smaller so both
// sides fit a 320-pt phone): the print, the bare piece's slot under its hanger.
const PRINT_W = 124;
const PRINT_H = 152;
const SLOT_W = 112;
const SLOT_H = 124;
// The bare piece hangs a little into its hanger, as on the rails.
const PIECE_TOP = HANGER_HEIGHT - 6;
// The print is the hero here, so it's tilted, the other way in RTL (rotation isn't mirrored).
const TILT = I18nManager.isRTL ? '3deg' : '-3deg';
// The bare piece swings once on its hanger after it comes in.
const SWING_AT = 3 * STAGGER_STEP + durations.enter;

const RULES = ['whole', 'flat', 'belts'] as const;
const FOCUS_AFTER_MS = 300;

type Props = {
  // first: before her first shot, with the two ways to take it; again: opened from "?".
  mode: 'first' | 'again';
  onShoot: () => void;
  onGallery: () => void;
  onClose: () => void;
};

// Before her first photo for the closet (owner, 2026-11-12, prototype
// `~/Desktop/closet/wrinkle-lab/design-first-photo`, screen 1 / direction A): on powder blue, the
// colour of the first screen and of something new, "before → after": her photo as a print (not in
// the closet yet) and the same piece bare on a hanger, the thread running from the print to the
// rail it will hang on. Then three rules for a photo that cuts out well. Shown once; "?" on the
// add-item band opens it again.
export function FirstPhotoHint({ mode, onShoot, onGallery, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const swing = useSharedValue(0);
  useEffect(() => {
    if (reduceMotion) return;
    const step = { duration: 320 };
    swing.value = withDelay(
      SWING_AT,
      withSequence(
        withTiming(7, step),
        withTiming(-4.5, step),
        withTiming(2.5, step),
        withTiming(-1, step),
        withTiming(0, step),
      ),
    );
  }, [reduceMotion, swing]);
  const turn = useAnimatedStyle(() => ({ transform: [{ rotate: `${swing.value}deg` }] }));
  // A screen reader starts on the title, on Android too (iOS follows accessibilityViewIsModal,
  // Android would stay on whatever had focus under the overlay). After a beat, once it's laid out.
  const title = useRef<ComponentRef<typeof Text>>(null);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (title.current) AccessibilityInfo.sendAccessibilityEvent(title.current, 'focus');
    }, FOCUS_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <View style={styles.screen} accessibilityViewIsModal testID="first-photo-hint">
      <ScrollView contentContainerStyle={styles.content}>
        <Animated.View entering={rise}>
          <Text style={styles.kicker}>{t('addItem.firstPhoto.kicker')}</Text>
          <Text ref={title} style={styles.title} accessibilityRole="header">
            {t('addItem.firstPhoto.title')}
          </Text>
        </Animated.View>

        {/* One picture for screen readers: what the photo becomes. */}
        <View
          style={styles.demo}
          accessible
          accessibilityRole="image"
          accessibilityLabel={t('addItem.firstPhoto.demo')}
        >
          {/* The thread from her photo to the rail the piece will hang on. */}
          <Animated.View entering={rise.delay(STAGGER_STEP * 2)} style={styles.rail} />
          <Animated.View entering={rise.delay(STAGGER_STEP)} style={styles.side}>
            <View style={[styles.print, cutoutShadow('hanging')]}>
              <View style={styles.picture}>
                <Image source={PIECE} style={styles.fill} contentFit="contain" />
              </View>
            </View>
            <Text style={styles.caption}>{t('addItem.firstPhoto.before')}</Text>
          </Animated.View>
          <Animated.View entering={rise.delay(STAGGER_STEP * 3)} style={styles.side}>
            <Animated.View style={[styles.slot, turn]}>
              <View style={styles.hanger}>
                <Hanger kind="coat" />
              </View>
              <View style={[styles.bare, cutoutShadow('hanging')]}>
                <Image source={PIECE} style={styles.fill} contentFit="contain" />
              </View>
            </Animated.View>
            <Text style={styles.caption}>{t('addItem.firstPhoto.after')}</Text>
          </Animated.View>
        </View>

        <View style={styles.rules}>
          {RULES.map((rule, index) => (
            <Animated.View
              key={rule}
              entering={rise.delay(STAGGER_STEP * (4 + index))}
              style={styles.rule}
            >
              <Text style={styles.number}>{index + 1}</Text>
              <Text style={styles.ruleText}>{t(`addItem.firstPhoto.rules.${rule}`)}</Text>
            </Animated.View>
          ))}
        </View>
      </ScrollView>

      <Animated.View
        entering={rise.delay(STAGGER_STEP * 7)}
        style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 16) }]}
      >
        {mode === 'first' ? (
          <>
            <Button kind="bright" label={t('addItem.firstPhoto.shoot')} onPress={onShoot} />
            <PressableScale style={styles.link} onPress={onGallery} accessibilityRole="button">
              <Text style={maison.link}>{t('addItem.choosePhoto')}</Text>
            </PressableScale>
          </>
        ) : (
          <Button kind="bright" label={t('addItem.firstPhoto.gotIt')} onPress={onClose} />
        )}
      </Animated.View>
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.ground,
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },
  kicker: {
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textMuted,
    textAlign: 'left',
  },
  title: {
    marginTop: 4,
    fontFamily: fonts.hand,
    fontSize: 30,
    lineHeight: 36,
    color: colors.text,
    textAlign: 'left',
  },
  demo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginTop: 24,
    paddingTop: 8,
  },
  side: {
    alignItems: 'center',
    width: '46%',
  },
  // Through the hook of the hanger, from the print's edge to the screen's gutter.
  rail: {
    position: 'absolute',
    top: 8 + HANGER_PIVOT_Y + 14,
    start: '40%',
    end: 0,
    height: 1.4,
    borderRadius: 1,
    backgroundColor: colors.text,
  },
  print: {
    width: PRINT_W,
    height: PRINT_H,
    padding: 7,
    paddingBottom: 20,
    backgroundColor: colors.paper,
    transform: [{ rotate: TILT }],
  },
  picture: {
    flex: 1,
    padding: 8,
    backgroundColor: colors.hero,
  },
  fill: {
    flex: 1,
  },
  // It turns around the hook, where the rail runs through it.
  slot: {
    width: SLOT_W,
    height: PIECE_TOP + SLOT_H,
    marginTop: 14,
    transformOrigin: ['50%', HANGER_PIVOT_Y, 0],
  },
  hanger: {
    alignSelf: 'center',
    width: HANGER_WIDTH,
    height: HANGER_HEIGHT,
  },
  bare: {
    position: 'absolute',
    top: PIECE_TOP,
    start: 0,
    width: SLOT_W,
    height: SLOT_H,
  },
  caption: {
    ...maison.note,
    marginTop: 12,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  rules: {
    marginTop: 26,
    gap: 12,
  },
  rule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  number: {
    width: 22,
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 30,
    color: colors.text,
    textAlign: 'center',
  },
  ruleText: {
    ...maison.body,
    flex: 1,
  },
  actions: {
    paddingTop: 12,
    paddingHorizontal: 20,
    gap: 6,
  },
  link: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

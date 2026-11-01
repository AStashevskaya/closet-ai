import { Image } from 'expo-image';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, Keyframe, useReducedMotion } from 'react-native-reanimated';

import { cutoutShadow } from '@/components/cutout-shadow';
import { Icon, type IconName } from '@/components/icon';
import { maison } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { CSS_EASE_OUT, durations, EASE_OUT, rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { cutoutFrame, type Size } from './cutout-frame';
import type { Cutout } from './wait-for-cutout';

export const PRINT_WIDTH = 176;
export const PRINT_HEIGHT = 214;
// The photo inside the print: the paper's border (9, 9, 26) and the grey's padding (10) taken off.
export const PICTURE = { width: PRINT_WIDTH - 18 - 20, height: PRINT_HEIGHT - 35 - 20 };
// Only the hero print is tilted (docs/design.md), the other way in RTL: rotation isn't mirrored.
const TILT = I18nManager.isRTL ? '3deg' : '-3deg';

type Props = {
  // The local photo, or null before one is picked.
  photoUri: string | null;
  // The name so far, handwritten under the photo as on a print.
  caption: string;
  // A photo being shrunk, turned or saved: it fades back a little and the tools are off.
  busy: boolean;
  // The piece is flying to its rail: the print fades as its photo leaves the frame.
  leaving: boolean;
  onRotate: () => void;
  onCrop: () => void;
  onAnother: () => void;
  // The photo inside the frame, measured for "Hang it up".
  pictureRef?: Ref<ComponentRef<typeof View>>;
  // A line under the print: what's going on with the photo.
  note: ReactNode;
  // The piece's cut-out once it's made: the photo's background dissolves around it.
  cutout?: Cutout | null;
  // The photo's size in pixels once it has loaded (reported by onPhotoSize), to lay the cut-out
  // exactly over the piece.
  photoSize?: Size | null;
  onPhotoSize?: (uri: string, size: Size) => void;
};

// How long the photo's background takes to dissolve when the cut-out comes.
export const DISSOLVE_MS = 400;

// The fallback for a cut-out without its box (made before the box was recorded): the server trims
// a cut-out to the piece, so drawn over the whole frame it's larger than the piece in the photo,
// and growing in from a little smaller hides that jump. With a box it's laid exactly over the
// piece and only fades in.
const cutoutIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.85 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(DISSOLVE_MS);
const fadeIn = FadeIn.duration(DISSOLVE_MS).easing(EASE_OUT);

// The top of the add-item screen: powder blue, the colour of something new arriving, with the
// piece on it as a white print and round Rotate / Crop / Another photo beside it. Before a photo
// it's an empty dashed print (not hers yet) saying how to shoot one.
export function PhotoBand({
  photoUri,
  caption,
  busy,
  leaving,
  onRotate,
  onCrop,
  onAnother,
  pictureRef,
  note,
  cutout,
  photoSize,
  onPhotoSize,
}: Props) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  // The cross-fade from photo to cut-out; with reduced motion it simply swaps.
  const dissolve = (property: 'opacity' | 'backgroundColor') => ({
    transitionProperty: property,
    transitionDuration: reduceMotion ? 0 : DISSOLVE_MS,
    transitionTimingFunction: CSS_EASE_OUT,
  });
  return (
    <View style={styles.band}>
      <View style={styles.stage}>
        {photoUri ? (
          // The entrance animates its own transform, so the tilt sits on the view inside it.
          <Animated.View entering={rise}>
            <Animated.View
              style={[
                styles.print,
                cutoutShadow('hanging'),
                {
                  opacity: leaving ? 0 : 1,
                  transitionProperty: 'opacity',
                  transitionDuration: durations.leave,
                  transitionTimingFunction: CSS_EASE_OUT,
                },
              ]}
            >
              {/* With the cut-out the background dissolves: the grey turns to the paper and the
                  photo fades from under the bare piece, which stays on the print. */}
              <Animated.View
                style={[styles.picture, cutout && styles.pictureBare, dissolve('backgroundColor')]}
              >
                <View ref={pictureRef} style={styles.image} collapsable={false}>
                  <Animated.View
                    style={[styles.image, cutout ? styles.gone : null, dissolve('opacity')]}
                    testID="band-photo"
                  >
                    <Image
                      source={{ uri: photoUri }}
                      style={[styles.image, busy && !cutout && styles.imageBusy]}
                      contentFit="contain"
                      transition={250}
                      onLoad={({ source }) =>
                        onPhotoSize?.(photoUri, { width: source.width, height: source.height })
                      }
                      accessibilityIgnoresInvertColors
                      testID="band-image"
                    />
                  </Animated.View>
                  {cutout && (
                    <CutoutImage
                      cutout={cutout}
                      frame={PICTURE}
                      photo={photoSize ?? null}
                      entering={reduceMotion ? 'none' : 'dissolve'}
                      testID="band-cutout"
                    />
                  )}
                </View>
              </Animated.View>
              <Text style={styles.caption} numberOfLines={1}>
                {caption.trim() || '…'}
              </Text>
            </Animated.View>
          </Animated.View>
        ) : (
          <Animated.View entering={rise}>
            <View style={[styles.print, styles.empty]}>
              <Text style={styles.hint}>{t('addItem.shootHint')}</Text>
            </View>
          </Animated.View>
        )}
        {photoUri && (
          <Animated.View entering={rise.delay(STAGGER_STEP * 2)} style={styles.tools}>
            <Tool icon="rotate" label={t('addItem.rotateShort')} onPress={onRotate} off={busy} />
            <Tool icon="crop" label={t('addItem.cropShort')} onPress={onCrop} off={busy} />
            <Tool icon="camera" label={t('addItem.anotherPhoto')} onPress={onAnother} off={busy} />
          </Animated.View>
        )}
      </View>
      <View style={styles.note}>{note}</View>
    </View>
  );
}

// The bare cut-out in a frame that shows its photo (the print's picture, or the photo's slot on
// its way to the rail): laid exactly over the piece by its box, or over the whole frame when
// there's no box or the photo's size isn't known yet (cut-outs made before the box was recorded).
// `entering` is how it appears on the print; on its way to the rail it's already there.
export function CutoutImage({
  cutout,
  frame,
  photo,
  entering = 'none',
  shadow = false,
  testID,
}: {
  cutout: Cutout;
  frame: Size;
  photo: Size | null;
  entering?: 'dissolve' | 'none';
  // The thread-tinted shadow of a piece in the closet (on its way to the rail).
  shadow?: boolean;
  testID?: string;
}) {
  const placed = cutout.box && photo ? cutoutFrame(frame, photo, cutout.box) : null;
  const animation = entering === 'none' ? undefined : placed ? fadeIn : cutoutIn;
  return (
    // The photo's own directions: placed by left / top, which React Native would swap in Hebrew,
    // while photo pixels are never mirrored.
    <View style={[StyleSheet.absoluteFill, styles.ltr]} pointerEvents="none">
      <Animated.View
        style={placed ? { position: 'absolute', ...placed } : StyleSheet.absoluteFill}
        entering={animation}
        testID={testID}
      >
        <View style={[styles.image, shadow && cutoutShadow('hanging')]}>
          <Image
            source={{ uri: cutout.uri, headers: cutout.headers }}
            style={styles.image}
            contentFit="contain"
            accessibilityIgnoresInvertColors
          />
        </View>
      </Animated.View>
    </View>
  );
}

function Tool({
  icon,
  label,
  onPress,
  off,
}: {
  icon: IconName;
  label: string;
  onPress: () => void;
  off: boolean;
}) {
  return (
    <PressableScale
      style={[styles.tool, off && styles.toolOff]}
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: off }}
    >
      <View style={styles.toolCircle}>
        <Icon name={icon} color={colors.text} size={20} strokeWidth={1.4} />
      </View>
      <Text style={styles.toolLabel}>{label}</Text>
    </PressableScale>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  band: {
    backgroundColor: colors.ground,
    paddingTop: 14,
    paddingBottom: 26,
  },
  stage: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 22,
    paddingHorizontal: 20,
  },
  print: {
    width: PRINT_WIDTH,
    height: PRINT_HEIGHT,
    paddingTop: 9,
    paddingHorizontal: 9,
    paddingBottom: 26,
    backgroundColor: colors.paper,
    transform: [{ rotate: TILT }],
  },
  picture: {
    flex: 1,
    padding: 10,
    backgroundColor: colors.hero,
  },
  image: {
    flex: 1,
  },
  ltr: {
    direction: 'ltr',
  },
  imageBusy: {
    opacity: 0.55,
  },
  pictureBare: {
    backgroundColor: colors.paper,
  },
  gone: {
    opacity: 0,
  },
  caption: {
    position: 'absolute',
    start: 9,
    end: 9,
    bottom: 3,
    fontFamily: fonts.hand,
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'center',
  },
  // Not hers yet: a dashed frame, no paper.
  empty: {
    backgroundColor: 'transparent',
    borderWidth: 1.4,
    borderStyle: 'dashed',
    borderColor: colors.text,
    padding: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: {
    fontFamily: fonts.hand,
    fontSize: 19,
    lineHeight: 23,
    color: colors.text,
    textAlign: 'center',
  },
  tools: {
    gap: 14,
  },
  tool: {
    alignItems: 'center',
    gap: 4,
    minWidth: 56,
    maxWidth: 84,
  },
  toolOff: {
    opacity: 0.5,
  },
  toolCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1.2,
    borderColor: colors.text,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolLabel: {
    ...maison.note,
    fontSize: 12.5,
    color: colors.text,
    textAlign: 'center',
  },
  note: {
    marginTop: 14,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
});

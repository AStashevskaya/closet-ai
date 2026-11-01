import { Image } from 'expo-image';
import type { ComponentRef, ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { cutoutShadow } from '@/components/cutout-shadow';
import { Icon, type IconName } from '@/components/icon';
import { maison } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { CSS_EASE_OUT, durations, rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

export const PRINT_WIDTH = 176;
export const PRINT_HEIGHT = 214;
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
};

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
}: Props) {
  const { t } = useTranslation();
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
              <View style={styles.picture}>
                <View ref={pictureRef} style={styles.image} collapsable={false}>
                  <Image
                    source={{ uri: photoUri }}
                    style={[styles.image, busy && styles.imageBusy]}
                    contentFit="contain"
                    transition={250}
                    accessibilityIgnoresInvertColors
                  />
                </View>
              </View>
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
  imageBusy: {
    opacity: 0.55,
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

import type { Item, ItemCategory } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut, Keyframe, useReducedMotion } from 'react-native-reanimated';

import { Hanger, HANGER_WIDTH, type HangerKind } from '@/components/hanger';
import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { absoluteUrl } from '@/lib/api';
import { CSS_EASE_OUT, durations, EASE_OUT } from '@/motion';
import { colors } from '@/theme';

// How a piece of each category sits on its rail: the size of its slot, where the picture starts
// under the hanger and how tall it may be. Shoes have no hanger: they stand on the floor line.
type Fit = { width: number; height: number; top: number; image: number; hanger?: HangerKind };
const FITS: Record<ItemCategory, Fit> = {
  top: { width: 118, height: 172, top: 22, image: 150, hanger: 'coat' },
  outerwear: { width: 118, height: 172, top: 22, image: 150, hanger: 'coat' },
  dress: { width: 128, height: 200, top: 22, image: 178, hanger: 'coat' },
  bottom: { width: 118, height: 172, top: 24, image: 148, hanger: 'clip' },
  accessory: { width: 96, height: 134, top: 12, image: 118, hanger: 'hook' },
  shoes: { width: 104, height: 104, top: 0, image: 100 },
};

// Pieces on a rail overlap a little, the way clothes are packed on a real one.
export const PIECE_OVERLAP = 12;

const badgeIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.85 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(durations.state);

type Props = {
  item: Item;
  headers: Record<string, string> | undefined;
  editing: boolean;
  // The server confirmed the delete; the piece fades out before it leaves the rail.
  leaving: boolean;
  // Opens the item screen; not set in edit mode, where the badge is the action.
  onPress?: () => void;
  onLongPress: () => void;
  onDelete: () => void;
};

// One item hanging on a closet rail: its cut-out under a hanger, no tile and no caption.
// Until the cut-out arrives, the photo hangs as a white-bordered print on a clip.
export function RailPiece({
  item,
  headers,
  editing,
  leaving,
  onPress,
  onLongPress,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const fit = FITS[item.category];
  const print = !item.cutoutUrl;
  const url = item.cutoutUrl ?? item.photoUrl;
  const standing = !fit.hanger;
  // In edit mode the pieces step back a little, like icons on the home screen.
  const scale = reduced ? 1 : leaving ? 0.92 : editing ? 0.96 : 1;

  return (
    <Animated.View
      style={[
        styles.cell,
        {
          width: fit.width,
          height: fit.height,
          opacity: leaving ? 0 : 1,
          transform: [{ scale }],
          transitionProperty: ['opacity', 'transform'],
          transitionDuration: leaving ? durations.leave : durations.state,
          transitionTimingFunction: CSS_EASE_OUT,
        },
      ]}
    >
      <PressableScale
        style={StyleSheet.absoluteFill}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={item.name}
        // Screen readers can't discover a long press or a small badge, so they get delete as a named action.
        accessibilityActions={[{ name: 'delete', label: t('closet.delete') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onDelete();
        }}
      >
        {fit.hanger && (
          <View style={styles.hanger}>
            <Hanger kind={print ? 'print' : fit.hanger} />
          </View>
        )}
        <View
          style={[
            print ? styles.print : styles.cutout,
            print
              ? standing
                ? styles.printStanding
                : styles.printHanging
              : { top: fit.top, height: fit.image },
          ]}
        >
          {url && headers ? (
            <Image
              source={{ uri: absoluteUrl(url), headers }}
              style={styles.fill}
              contentFit={print ? 'cover' : 'contain'}
              // Hung from the top, stood on the bottom, whatever the picture's own proportions.
              contentPosition={print ? 'center' : standing ? 'bottom' : 'top'}
              transition={200}
              accessibilityIgnoresInvertColors
              testID="item-photo"
            />
          ) : null}
        </View>
      </PressableScale>

      {editing && (
        <Animated.View
          entering={badgeIn}
          exiting={FadeOut.duration(durations.press)}
          style={[styles.badgeSlot, { top: standing ? 4 : 24 }]}
        >
          <PressableScale
            style={styles.badge}
            onPress={onDelete}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('closet.deleteItem', { name: item.name })}
          >
            <Icon name="close" color={colors.accent} size={16} strokeWidth={1.6} />
          </PressableScale>
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  cell: {
    marginEnd: -PIECE_OVERLAP,
  },
  // Centred over the piece, the hook on the rail.
  hanger: {
    position: 'absolute',
    top: 0,
    start: 0,
    end: 0,
    alignItems: 'center',
  },
  cutout: {
    position: 'absolute',
    start: 0,
    end: 0,
  },
  // A small photo print with a white border, as in the collages.
  print: {
    position: 'absolute',
    alignSelf: 'center',
    width: HANGER_WIDTH - 2,
    height: 104,
    borderWidth: 4,
    borderColor: colors.paper,
    backgroundColor: colors.hero,
    shadowColor: colors.accentDark,
    shadowOpacity: 0.12,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  printHanging: {
    top: 26,
  },
  printStanding: {
    bottom: 0,
    height: 96,
  },
  fill: {
    flex: 1,
  },
  badgeSlot: {
    position: 'absolute',
    end: 4,
  },
  // A milky disc with a hairline edge: it sits on any piece without shouting.
  badge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    shadowColor: colors.accentDark,
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
});

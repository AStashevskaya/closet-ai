import type { Item } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text } from 'react-native';
import Animated, { FadeOut, Keyframe, useReducedMotion } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { ItemPhoto } from '@/components/item-photo';
import { PressableScale } from '@/components/pressable-scale';
import { CSS_EASE_OUT, durations, EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

// Cards rise a few points into place; nothing grows from nothing.
const rise = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 14 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE_OUT },
}).duration(durations.enter);

const badgeIn = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 0.85 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(durations.state);

type Props = {
  item: Item;
  headers: Record<string, string> | undefined;
  editing: boolean;
  // The server confirmed the delete; the card fades out before it leaves the list.
  leaving: boolean;
  // Only set on the first load, so cards don't replay their entrance when the list re-renders.
  enterDelay?: number;
  // Opens the item screen; not set in edit mode, where the badge is the action.
  onPress?: () => void;
  onLongPress: () => void;
  onDelete: () => void;
};

export function ClosetCard({
  item,
  headers,
  editing,
  leaving,
  enterDelay,
  onPress,
  onLongPress,
  onDelete,
}: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // In edit mode the cards step back a little, like icons on the home screen, so the badges read as removable.
  const scale = reduced ? 1 : leaving ? 0.92 : editing ? 0.96 : 1;

  return (
    <Animated.View
      entering={enterDelay === undefined ? undefined : rise.delay(enterDelay)}
      style={[
        styles.cell,
        {
          opacity: leaving ? 0 : 1,
          transform: [{ scale }],
          transitionProperty: ['opacity', 'transform'],
          transitionDuration: leaving ? durations.leave : durations.state,
          transitionTimingFunction: CSS_EASE_OUT,
        },
      ]}
    >
      <PressableScale
        style={styles.card}
        onPress={onPress}
        onLongPress={onLongPress}
        // Screen readers can't discover a long press or a small badge, so they get delete as a named action.
        accessibilityActions={[{ name: 'delete', label: t('closet.delete') }]}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === 'delete') onDelete();
        }}
      >
        <ItemPhoto item={item} headers={headers} style={styles.photo} />
        <Text style={styles.name} numberOfLines={2}>
          {item.name}
        </Text>
        <Text style={styles.category}>{t(`categories.${item.category}`)}</Text>
      </PressableScale>

      {editing && (
        <Animated.View
          entering={badgeIn}
          exiting={FadeOut.duration(durations.press)}
          style={styles.badgeSlot}
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

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  cell: {
    flex: 1,
  },
  card: {
    gap: 4,
  },
  photo: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 18,
  },
  name: {
    marginTop: 6,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
  },
  category: {
    fontFamily: fonts.body,
    fontSize: 12,
    letterSpacing: 0.4,
    color: colors.textMuted,
    textAlign: 'left',
  },
  badgeSlot: {
    position: 'absolute',
    top: 10,
    end: 10,
  },
  // A milky disc with a hairline edge: it sits on any photo without shouting.
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

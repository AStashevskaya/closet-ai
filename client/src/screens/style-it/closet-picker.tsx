import { ITEM_CATEGORIES, type Item, type OutfitMood } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, Keyframe, useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemPhoto } from '@/components/item-photo';
import { MoodChips } from '@/components/mood-chips';
import { PressableScale } from '@/components/pressable-scale';
import { durations, EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

type Props = {
  visible: boolean;
  items: Item[];
  headers: Record<string, string> | undefined;
  mood: OutfitMood | null;
  onMood: (mood: OutfitMood | null) => void;
  onPick: (item: Item) => void;
  onClose: () => void;
};

// The sheet answers a tap, so it comes up quicker than blocks that appear on their own.
const sheetIn = new Keyframe({
  0: { opacity: 0, transform: [{ translateY: 40 }] },
  100: { opacity: 1, transform: [{ translateY: 0 }], easing: EASE_OUT },
}).duration(durations.leave);

// "From my closet" in Style it's diary (decided 2026-10-28): the whole closet by category, from a
// sheet, so no piece is out of reach (the old row showed the first 24), with the mood to keep to.
export function ClosetPicker({ visible, items, headers, mood, onMood, onPick, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const reduceMotion = useReducedMotion();
  const groups = ITEM_CATEGORIES.map((category) => ({
    category,
    items: items.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <Animated.View
        entering={reduceMotion ? undefined : FadeIn.duration(durations.state)}
        style={StyleSheet.absoluteFill}
      >
        <View style={styles.tint} />
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel={t('common.close')}
        />
      </Animated.View>
      <Animated.View
        entering={reduceMotion ? undefined : sheetIn}
        style={[
          styles.sheet,
          { paddingTop: 20, paddingBottom: insets.bottom + 12, top: insets.top + 48 },
        ]}
      >
        <Text style={styles.title} accessibilityRole="header">
          {t('styleIt.closet')}
        </Text>
        <Text style={styles.hint}>{t('styleIt.closetHint')}</Text>
        <MoodChips mood={mood} onChange={onMood} inset={20} />
        <ScrollView contentContainerStyle={styles.groups}>
          {groups.map(({ category, items: pieces }) => (
            <View key={category} style={styles.group}>
              <Text style={styles.category}>{t(`closet.filters.${category}`)}</Text>
              <View style={styles.grid}>
                {pieces.map((item) => (
                  <PressableScale
                    key={item.id}
                    style={styles.cell}
                    onPress={() => onPick(item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${t('wearWith.button')} ${item.name}`}
                  >
                    <ItemPhoto item={item} headers={headers} style={styles.photo} />
                    <Text style={styles.name} numberOfLines={2}>
                      {item.name}
                    </Text>
                  </PressableScale>
                ))}
              </View>
            </View>
          ))}
        </ScrollView>
      </Animated.View>
    </Modal>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  // The thread colour, thinned, apart from the fade (which animates its own view's opacity).
  tint: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.text,
    opacity: 0.28,
  },
  sheet: {
    position: 'absolute',
    start: 0,
    end: 0,
    bottom: 0,
    gap: 10,
    backgroundColor: colors.background,
  },
  title: {
    marginHorizontal: 20,
    fontFamily: fonts.display,
    fontSize: 28,
    lineHeight: 32,
    color: colors.text,
    textAlign: 'left',
  },
  hint: {
    marginHorizontal: 20,
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    textAlign: 'left',
  },
  groups: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 22,
  },
  group: {
    gap: 8,
  },
  category: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'left',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  // Four to a row.
  cell: {
    width: '23%',
    gap: 4,
  },
  photo: {
    aspectRatio: 1,
    backgroundColor: colors.hero,
  },
  name: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textSecondary,
    textAlign: 'left',
  },
});

import type { ItemCategory } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { CSS_EASE_OUT, durations } from '@/motion';
import { colors, fonts } from '@/theme';

export type Filter = ItemCategory | 'all';

type Props = {
  // Only the categories the closet actually has, so no chip leads to an empty grid.
  categories: readonly ItemCategory[];
  value: Filter;
  onChange: (filter: Filter) => void;
};

export function CategoryFilter({ categories, value, onChange }: Props) {
  const { t } = useTranslation();
  const filters: Filter[] = ['all', ...categories];

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      {filters.map((filter) => {
        const selected = filter === value;
        return (
          <PressableScale
            key={filter}
            style={[styles.chip, selected && styles.selected]}
            onPress={() => {
              if (selected) return;
              void Haptics.selectionAsync();
              onChange(filter);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected }}
          >
            <Animated.Text
              style={[
                styles.label,
                selected && styles.labelSelected,
                {
                  transitionProperty: 'color',
                  transitionDuration: durations.state,
                  transitionTimingFunction: CSS_EASE_OUT,
                },
              ]}
            >
              {t(`closet.filters.${filter}`)}
            </Animated.Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // The row scrolls edge to edge; only its content is inset.
  scroll: {
    flexGrow: 0,
    marginBottom: 18,
  },
  row: {
    paddingHorizontal: 22,
    gap: 8,
  },
  chip: {
    height: 36,
    paddingHorizontal: 16,
    borderRadius: 18,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  selected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  label: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textSecondary,
  },
  labelSelected: {
    color: colors.onAccent,
  },
});

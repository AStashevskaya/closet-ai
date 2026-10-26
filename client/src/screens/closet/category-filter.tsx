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

// Plain words; the chosen one on the bright colour, the one accent of the row.
const styles = StyleSheet.create({
  // The row scrolls edge to edge; only its content is inset.
  scroll: {
    flexGrow: 0,
    marginBottom: 14,
  },
  row: {
    paddingHorizontal: 10,
    gap: 4,
  },
  chip: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    justifyContent: 'center',
  },
  selected: {
    backgroundColor: colors.bead,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
  },
  labelSelected: {
    color: colors.onBead,
  },
});

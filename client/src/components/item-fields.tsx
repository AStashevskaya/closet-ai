import { ITEM_CATEGORIES, ITEM_COLORS, type ItemCategory, type ItemColor } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { colors, fonts } from '@/theme';

export const MAX_COLORS = 5;

type Props = {
  name: string;
  onNameChange: (name: string) => void;
  category: ItemCategory | null;
  onCategoryChange: (category: ItemCategory) => void;
  itemColors: ItemColor[];
  onColorsChange: (itemColors: ItemColor[]) => void;
};

// Name, category and colour chips of an item: the add-item form and each row of the
// several-items list. A fragment, so the fields sit in the parent's own layout and spacing.
export function ItemFields({
  name,
  onNameChange,
  category,
  onCategoryChange,
  itemColors,
  onColorsChange,
}: Props) {
  const { t } = useTranslation();

  function toggleColor(color: ItemColor) {
    onColorsChange(
      itemColors.includes(color)
        ? itemColors.filter((c) => c !== color)
        : itemColors.length < MAX_COLORS
          ? [...itemColors, color]
          : itemColors,
    );
  }

  return (
    <>
      <Text style={styles.label}>{t('addItem.name')}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={onNameChange}
        placeholder={t('addItem.namePlaceholder')}
        placeholderTextColor={colors.textMuted}
        maxLength={120}
        accessibilityLabel={t('addItem.name')}
      />

      <Text style={styles.label}>{t('addItem.category')}</Text>
      <View style={styles.chips}>
        {ITEM_CATEGORIES.map((c) => (
          <Chip
            key={c}
            label={t(`categories.${c}`)}
            selected={category === c}
            onPress={() => onCategoryChange(c)}
          />
        ))}
      </View>

      <Text style={styles.label}>
        {t('addItem.colors')} <Text style={styles.hint}>· {t('addItem.colorsHint')}</Text>
      </Text>
      <View style={styles.chips}>
        {ITEM_COLORS.map((c) => (
          <Chip
            key={c}
            label={t(`colors.${c}`)}
            color={c}
            selected={itemColors.includes(c)}
            onPress={() => toggleColor(c)}
          />
        ))}
      </View>
    </>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  label: {
    marginTop: 12,
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
  },
  hint: {
    fontFamily: fonts.body,
    color: colors.textMuted,
  },
  input: {
    height: 48,
    // Underlined, as on a brand's checkout, instead of boxed.
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
});

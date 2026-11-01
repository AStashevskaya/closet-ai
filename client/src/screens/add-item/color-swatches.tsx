import { ITEM_COLORS, type ItemColor } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { MULTICOLOR, SWATCHES } from '@/components/chip';
import { MAX_COLORS } from '@/components/item-fields';
import { PressableScale } from '@/components/pressable-scale';
import { maison } from '@/components/maison';
import { colors } from '@/theme';

type Props = {
  value: ItemColor[];
  onChange: (value: ItemColor[]) => void;
};

// The colours stop: every colour as a round swatch, the picked ones ringed with the bead and
// named after the row (the prototype's swatches; the chips with names took four rows). Each
// swatch is a checkbox named for screen readers. Up to MAX_COLORS, as in the other forms.
export function ColorSwatches({ value, onChange }: Props) {
  const { t } = useTranslation();

  function toggle(color: ItemColor) {
    void Haptics.selectionAsync();
    onChange(
      value.includes(color)
        ? value.filter((c) => c !== color)
        : value.length < MAX_COLORS
          ? [...value, color]
          : value,
    );
  }

  return (
    <View style={styles.block}>
      <View style={styles.row}>
        {ITEM_COLORS.map((color) => {
          const on = value.includes(color);
          return (
            <PressableScale
              key={color}
              style={[styles.ring, on && styles.ringOn]}
              onPress={() => toggle(color)}
              hitSlop={4}
              accessibilityRole="checkbox"
              accessibilityLabel={t(`colors.${color}`)}
              accessibilityState={{ checked: on }}
            >
              {color === 'multicolor' ? (
                <View style={[styles.swatch, styles.multicolor]}>
                  {MULTICOLOR.map((c) => (
                    <View key={c} style={[styles.stripe, { backgroundColor: c }]} />
                  ))}
                </View>
              ) : (
                <View style={[styles.swatch, { backgroundColor: SWATCHES[color] }]} />
              )}
            </PressableScale>
          );
        })}
      </View>
      {value.length > 0 && (
        <Text style={maison.note} importantForAccessibility="no" accessibilityElementsHidden>
          {value.map((c) => t(`colors.${c}`)).join(', ')}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  // A 36pt target; the swatch inside, with a white gap before the bead's ring when picked.
  ring: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ringOn: {
    borderColor: colors.bead,
  },
  swatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textMuted,
    overflow: 'hidden',
  },
  multicolor: {
    flexDirection: 'row',
  },
  stripe: {
    flex: 1,
  },
});

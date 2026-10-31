import { BODY_SHAPES, type BodyShape } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { PressableScale } from '@/components/pressable-scale';
import { colors, fonts } from '@/theme';

// Each shape drawn by hand as two outlines, shoulders to hips (from the prototype, 34 × 56).
const OUTLINES: Record<BodyShape, string> = {
  hourglass:
    'M6 6 C10 8 24 8 28 6 C26 18 20 24 20 28 C20 32 28 40 29 52 M6 6 C8 18 14 24 14 28 C14 32 6 40 5 52',
  triangle:
    'M11 6 C14 8 20 8 23 6 C24 18 22 24 22 30 C24 38 31 44 32 52 M11 6 C10 18 12 24 12 30 C10 38 3 44 2 52',
  inverted_triangle:
    'M3 6 C10 9 24 9 31 6 C28 18 24 26 22 32 C22 40 24 46 24 52 M3 6 C6 18 10 26 12 32 C12 40 10 46 10 52',
  rectangle:
    'M8 6 C12 8 22 8 26 6 C26 18 25 28 25 32 C25 40 26 46 26 52 M8 6 C8 18 9 28 9 32 C9 40 8 46 8 52',
  oval: 'M9 6 C12 8 22 8 25 6 C30 18 32 26 30 34 C28 42 26 46 26 52 M9 6 C4 18 2 26 4 34 C6 42 8 46 8 52',
};

type Props = {
  value: BodyShape | null;
  // The same shape again clears it.
  onChange: (shape: BodyShape | null) => void;
};

// Body shapes as drawn silhouettes rather than words alone (My profile, 2026-10-29): one row that
// scrolls sideways, the chosen one on the ground colour and drawn in the bead.
export function BodyShapes({ value, onChange }: Props) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      accessibilityRole="radiogroup"
    >
      {BODY_SHAPES.map((shape) => {
        const on = value === shape;
        return (
          <PressableScale
            key={shape}
            style={[styles.shape, on && styles.on]}
            onPress={() => onChange(on ? null : shape)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            accessibilityLabel={t(`details.shapes.${shape}`)}
          >
            <Svg width={34} height={56} viewBox="0 0 34 56">
              <Path
                d={OUTLINES[shape]}
                fill="none"
                stroke={on ? colors.bead : colors.text}
                strokeWidth={on ? 1.6 : 1.3}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
            <Text style={styles.label} numberOfLines={2}>
              {t(`details.shapes.${shape}`)}
            </Text>
          </PressableScale>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: 6,
    paddingVertical: 4,
  },
  shape: {
    width: 76,
    minHeight: 96,
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    borderRadius: 4,
  },
  on: {
    backgroundColor: colors.background,
  },
  label: {
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

import { OUTFIT_MOODS, type OutfitMood } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet } from 'react-native';

import { Chip } from '@/components/chip';

type Props = {
  mood: OutfitMood | null;
  // Tapping the chosen mood again takes it back (any mood).
  onChange: (mood: OutfitMood | null) => void;
  // Room before the first chip and after the last, for a row that runs to the screen's edges.
  inset?: number;
};

// The mood "what do I wear this with?" should keep to, in one scrolling row; none chosen means any.
export function MoodChips({ mood, onChange, inset = 2 }: Props) {
  const { t } = useTranslation();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[styles.row, { paddingHorizontal: inset }]}
      style={styles.scroll}
    >
      {OUTFIT_MOODS.map((m) => (
        <Chip
          key={m}
          label={t(`wearWith.moods.${m}`)}
          selected={mood === m}
          onPress={() => onChange(mood === m ? null : m)}
        />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    alignSelf: 'stretch',
  },
  row: {
    gap: 8,
  },
});

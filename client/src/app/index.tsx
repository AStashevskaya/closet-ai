import { ITEM_CATEGORIES, itemCategory } from '@closet-ai/shared';
import { ScrollView, StyleSheet, Text } from 'react-native';

// Placeholder screen that proves the workspace link to @closet-ai/shared works.
// It only renders data from shared: UI copy waits for i18n (he, ru).
export default function HomeScreen() {
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {ITEM_CATEGORIES.map((category) => (
        <Text key={category} style={styles.text}>
          {category}: {itemCategory.safeParse(category).success ? '✓' : '✗'}
        </Text>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 8,
  },
  text: {
    fontSize: 16,
    // textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
    textAlign: 'left',
  },
});

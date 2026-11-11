import { StyleSheet, View } from 'react-native';

import { SilhouetteHanger, type Silhouette } from '@/components/silhouette-hanger';
import { colors } from '@/theme';

// The hangers on the auth band, smaller than on a closet rail.
const HANGER = 54;
// A tee, a dress, a long coat, a shirt and a knit.
const SHAPES: Silhouette[] = ['tee', 'dress', 'coat', 'shirt', 'knit'];

// The rail on the auth band (decided 2026-10-31, prototype `~/Desktop/closet/wrinkle-lab/design-adding`,
// "auth", direction "Выбрано"): empty hangers swaying on sign-up; on sign-in faint grey pieces
// appear on them one after another, and empty again when she goes back. Decoration (the caption
// under it says the same), so screen readers skip it.
export function AuthRail({ filled }: { filled: boolean }) {
  return (
    <View
      style={styles.rail}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <View style={styles.bar} />
      <View style={styles.hangers}>
        {SHAPES.map((shape, index) => (
          <SilhouetteHanger
            key={shape}
            index={index}
            shape={shape}
            filled={filled}
            width={HANGER}
            testID="auth-rail-piece"
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    height: 150,
    marginTop: 4,
  },
  bar: {
    position: 'absolute',
    top: 30,
    start: 26,
    end: 26,
    height: 2,
    borderRadius: 1,
    backgroundColor: colors.text,
  },
  hangers: {
    position: 'absolute',
    top: 22,
    start: 36,
    end: 36,
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
});

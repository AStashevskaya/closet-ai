import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  Easing,
  Keyframe,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { cutoutShadow } from '@/components/cutout-shadow';
import { absoluteUrl } from '@/lib/api';
import { durations, EASE_OUT } from '@/motion';
import { colors, fonts } from '@/theme';

type Props = {
  item: Item;
  headers: Record<string, string> | undefined;
  onPress: () => void;
};

// The block settles in from a little zoom, the way a brand's home page opens.
const settle = new Keyframe({
  0: { opacity: 0, transform: [{ scale: 1.04 }] },
  100: { opacity: 1, transform: [{ scale: 1 }], easing: EASE_OUT },
}).duration(durations.settle);

const BREATH_MS = 7000;

// The newest item on the bright colour: the one editorial block of the closet, with its own
// way into "what do I wear this with?".
export function NewIn({ item, headers, onPress }: Props) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // The picture breathes, very slowly.
  const breath = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    breath.value = withRepeat(
      withTiming(1, { duration: BREATH_MS, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [breath, reduced]);
  const breathing = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + breath.value * 0.05 }, { translateY: -breath.value * 6 }],
  }));

  const url = item.cutoutUrl ?? item.photoUrl;
  return (
    <Animated.View entering={settle}>
      <PressableScale
        style={styles.block}
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${t('closet.newIn')}: ${item.name}`}
      >
        <View style={styles.text}>
          <Text style={styles.eyebrow}>{t('closet.newIn')}</Text>
          <Text style={styles.name} numberOfLines={3}>
            {item.name}
          </Text>
          <Text style={styles.link}>{t('wearWith.button')}</Text>
        </View>
        {url && headers ? (
          <Animated.View style={[styles.picture, item.cutoutUrl && styles.shadow, breathing]}>
            <Image
              source={{ uri: absoluteUrl(url), headers }}
              style={styles.image}
              contentFit={item.cutoutUrl ? 'contain' : 'cover'}
              transition={300}
              accessibilityIgnoresInvertColors
            />
          </Animated.View>
        ) : null}
      </PressableScale>
    </Animated.View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  block: {
    height: 240,
    marginHorizontal: 10,
    marginBottom: 18,
    flexDirection: 'row',
    overflow: 'hidden',
    backgroundColor: colors.ground,
  },
  text: {
    flex: 1,
    justifyContent: 'flex-end',
    padding: 18,
    gap: 6,
  },
  eyebrow: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text,
    textAlign: 'left',
  },
  name: {
    fontFamily: fonts.displayLight,
    fontSize: 30,
    lineHeight: 32,
    color: colors.text,
    textAlign: 'left',
  },
  link: {
    marginTop: 8,
    alignSelf: 'flex-start',
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.text,
    textDecorationLine: 'underline',
  },
  picture: {
    width: '50%',
    padding: 16,
  },
  image: {
    flex: 1,
  },
  shadow: cutoutShadow('hanging'),
});

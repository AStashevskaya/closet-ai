import type { CatalogItem } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { HangerLoader } from '@/components/hanger-loader';
import { Button, maison } from '@/components/maison';
import { absoluteUrl, getCatalogItem, sessionHeaders } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { priceLabel } from '@/lib/price';
import { rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'done'; item: CatalogItem; headers: Record<string, string> };

// A partner brand's piece the stylist suggested: the picture, the brand, the price and the way
// to the brand's site. Labelled as a partner's; a demo brand's link leads nowhere, so it isn't
// offered.
export function CatalogItemScreen({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const lang = appLanguage(i18n.language);
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    // An effect can't be async itself, so the async work goes in an inner function.
    const load = async () => {
      try {
        const [item, headers] = await Promise.all([getCatalogItem(id, lang), sessionHeaders()]);
        if (!cancelled) setState({ status: 'done', item, headers });
      } catch (cause) {
        if (__DEV__) console.warn('Loading the partner item failed', cause);
        if (!cancelled) setState({ status: 'failed' });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, lang]);

  if (state.status === 'loading') {
    return (
      <View style={styles.center}>
        <HangerLoader />
      </View>
    );
  }
  if (state.status === 'failed') {
    return (
      <View style={styles.center}>
        <Text style={[maison.body, styles.centered]}>{t('partner.failed')}</Text>
      </View>
    );
  }

  const { item, headers } = state;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Animated.View entering={rise} style={styles.frame}>
        <Image
          source={{ uri: absoluteUrl(item.imageUrl), headers }}
          style={styles.image}
          contentFit="contain"
          transition={300}
          accessibilityIgnoresInvertColors
        />
      </Animated.View>

      <Animated.View entering={rise.delay(STAGGER_STEP)} style={[maison.gutter, styles.details]}>
        <Text style={styles.label}>{t(item.demo ? 'partner.demoLabel' : 'partner.label')}</Text>
        <Text style={styles.brand}>{item.brand}</Text>
        <Text style={styles.name} accessibilityRole="header">
          {item.name}
        </Text>
        <Text style={styles.price}>
          {priceLabel(item.price, item.currency)}
          {!item.inStock && ` · ${t('partner.soldOut')}`}
        </Text>
        {item.demo ? (
          <Text style={[maison.body, styles.note]}>{t('partner.demoNote')}</Text>
        ) : (
          <Button
            label={t('partner.toSite')}
            onPress={() => void Linking.openURL(item.url)}
            style={styles.button}
          />
        )}
      </Animated.View>
    </ScrollView>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 48,
    gap: 24,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  centered: {
    textAlign: 'center',
  },
  frame: {
    marginHorizontal: 10,
    aspectRatio: 1,
    padding: 32,
    backgroundColor: colors.hero,
  },
  image: {
    flex: 1,
  },
  details: {
    gap: 6,
  },
  label: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 2,
    backgroundColor: colors.highlight,
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.text,
    textAlign: 'left',
  },
  brand: {
    marginTop: 8,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
    textAlign: 'left',
  },
  name: {
    fontFamily: fonts.displayLight,
    fontSize: 36,
    lineHeight: 40,
    color: colors.text,
    textAlign: 'left',
  },
  price: {
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  note: {
    marginTop: 12,
  },
  button: {
    marginTop: 16,
  },
});

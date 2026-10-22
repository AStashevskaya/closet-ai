import { ITEM_CATEGORIES, type CatalogItem } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { HangerLoader } from '@/components/hanger-loader';
import { maison, ScreenTitle } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { absoluteUrl, listCatalog, sessionHeaders } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { priceLabel } from '@/lib/price';
import { rise } from '@/motion';
import { CategoryFilter, type Filter } from '@/screens/closet/category-filter';
import { colors, fonts } from '@/theme';

type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'done'; items: CatalogItem[]; headers: Record<string, string> };

// The Edit: partner brands' pieces, the ones closest to the user's closet first (the server
// orders them), filtered by category on the phone. Labelled as partners'; a piece opens its card.
export function TheEdit() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');

  useEffect(() => {
    let cancelled = false;
    // An effect can't be async itself, so the async work goes in an inner function.
    const load = async () => {
      try {
        const [items, headers] = await Promise.all([listCatalog(lang), sessionHeaders()]);
        if (!cancelled) setState({ status: 'done', items, headers });
      } catch (cause) {
        if (__DEV__) console.warn('Loading the Edit failed', cause);
        if (!cancelled) setState({ status: 'failed' });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [lang]);

  if (state.status !== 'done') {
    return (
      <View style={styles.center}>
        {state.status === 'loading' ? (
          <HangerLoader />
        ) : (
          <Text style={[maison.body, styles.centered]}>{t('edit.failed')}</Text>
        )}
      </View>
    );
  }

  const { items, headers } = state;
  const categories = ITEM_CATEGORIES.filter((c) => items.some((item) => item.category === c));
  const visible = filter === 'all' ? items : items.filter((item) => item.category === filter);
  const label = t(items.some((item) => item.demo) ? 'partner.demoLabel' : 'partner.label');

  return (
    <FlatList
      style={styles.screen}
      data={visible}
      key={filter}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <Animated.View entering={rise} style={styles.header}>
          <View style={maison.gutter}>
            <ScreenTitle title={t('edit.title')} subtitle={t('edit.subtitle')} />
            <Text style={[styles.label, styles.headerLabel]}>{label}</Text>
          </View>
          {categories.length > 1 && (
            <CategoryFilter categories={categories} value={filter} onChange={setFilter} />
          )}
        </Animated.View>
      }
      ListEmptyComponent={<Text style={[maison.body, maison.gutter]}>{t('edit.empty')}</Text>}
      renderItem={({ item }) => {
        const price = priceLabel(item.price, item.currency);
        return (
          <PressableScale
            style={styles.tile}
            onPress={() => router.push({ pathname: '/catalog/[id]', params: { id: item.id } })}
            accessibilityRole="button"
            accessibilityLabel={`${item.brand}, ${item.name}, ${price}`}
          >
            <View style={styles.frame}>
              <Image
                source={{ uri: absoluteUrl(item.imageUrl), headers }}
                style={styles.image}
                contentFit="contain"
                transition={200}
                accessibilityIgnoresInvertColors
              />
            </View>
            <Text style={styles.brand}>{item.brand}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.price}>{price}</Text>
          </PressableScale>
        );
      }}
    />
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
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
  content: {
    paddingBottom: 48,
    gap: 20,
  },
  header: {
    gap: 16,
    paddingTop: 8,
  },
  headerLabel: {
    marginTop: 12,
  },
  row: {
    paddingHorizontal: 20,
    gap: 12,
  },
  tile: {
    flex: 1,
    gap: 3,
  },
  frame: {
    aspectRatio: 3 / 4,
    padding: 14,
    backgroundColor: colors.hero,
  },
  image: {
    flex: 1,
  },
  label: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: colors.highlight,
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.text,
  },
  brand: {
    marginTop: 6,
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.textMuted,
    textAlign: 'left',
  },
  name: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
  },
  price: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'left',
  },
});

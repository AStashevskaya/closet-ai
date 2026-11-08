import { ITEM_CATEGORIES, type CatalogFeedItem } from '@closet-ai/shared';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { HangerLoader } from '@/components/hanger-loader';
import { Icon } from '@/components/icon';
import { maison, ScreenTitle } from '@/components/maison';
import { useTabBarClearance } from '@/components/tab-bar';
import { listCatalog, sessionHeaders } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { rise, STAGGER_STEP } from '@/motion';
import { CategoryFilter, type Filter } from '@/screens/closet/category-filter';
import { colors, fonts } from '@/theme';

import { Spread } from './spread';

type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'done'; items: CatalogFeedItem[]; headers: Record<string, string> };

// Brands (The Edit in code), a tab since 2026-11-08, read as a magazine issue (`spread.tsx`):
// partner brands' pieces, the ones closest to the user's closet first (the server orders them),
// filtered by category on the phone. Each is labelled as a partner's or demo, and opens its card.
// There's a way in to Recreate the look at the top.
export function TheEdit() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const [state, setState] = useState<State>({ status: 'loading' });
  const [filter, setFilter] = useState<Filter>('all');
  const insets = useSafeAreaInsets();
  const clearance = useTabBarClearance();
  const { width } = useWindowDimensions();

  // A tab stays mounted, so it reads again each time it's opened: the order follows her closet,
  // and a load that failed gets another try. What's on screen stays if the new read fails.
  const load = useCallback(
    async (isCancelled: () => boolean = () => false) => {
      try {
        const [items, headers] = await Promise.all([listCatalog(lang), sessionHeaders()]);
        if (!isCancelled()) setState({ status: 'done', items, headers });
      } catch (cause) {
        if (__DEV__) console.warn('Loading the Edit failed', cause);
        if (!isCancelled()) {
          setState((current) => (current.status === 'done' ? current : { status: 'failed' }));
        }
      }
    },
    [lang],
  );
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void load(() => cancelled);
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  // The same on every state, so Recreate the look can be reached while the catalog can't.
  const heading = (
    <View style={maison.gutter}>
      <ScreenTitle title={t('edit.title')} subtitle={t('edit.subtitle')} />
      <Pressable
        style={styles.recreate}
        onPress={() => router.push('/want-can')}
        accessibilityRole="button"
      >
        <View style={styles.recreateText}>
          <Text style={styles.recreateTitle}>{t('want.title')}</Text>
          <Text style={maison.note}>{t('edit.recreateNote')}</Text>
        </View>
        <Icon name="chevron" color={colors.iconMuted} size={16} strokeWidth={1.4} />
      </Pressable>
    </View>
  );

  if (state.status !== 'done') {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 20 }]}>
        {heading}
        <View style={styles.center}>
          {state.status === 'loading' ? (
            <HangerLoader />
          ) : (
            <>
              <Text style={[maison.body, styles.centered]}>{t('edit.failed')}</Text>
              <Pressable onPress={() => void load()} hitSlop={8} accessibilityRole="button">
                <Text style={maison.link}>{t('edit.retry')}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    );
  }

  const { items, headers } = state;
  const categories = ITEM_CATEGORIES.filter((c) => items.some((item) => item.category === c));
  // A category can be gone after a new read; its chip with it, so she couldn't get back.
  const active = filter !== 'all' && categories.includes(filter) ? filter : 'all';
  const visible = active === 'all' ? items : items.filter((item) => item.category === active);

  return (
    <FlatList
      style={styles.screen}
      data={visible}
      key={active}
      keyExtractor={(item) => item.id}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 20, paddingBottom: clearance },
      ]}
      ListHeaderComponent={
        <Animated.View entering={rise} style={styles.header}>
          {heading}
          {categories.length > 1 && (
            <CategoryFilter categories={categories} value={active} onChange={setFilter} />
          )}
        </Animated.View>
      }
      ListEmptyComponent={<Text style={[maison.body, maison.gutter]}>{t('edit.empty')}</Text>}
      renderItem={({ item, index }) => (
        // Only the first screen staggers: a page scrolled back to mustn't wait to reappear.
        <Animated.View entering={index < 3 ? rise.delay(STAGGER_STEP * index) : undefined}>
          <Spread
            item={item}
            headers={headers}
            width={width}
            flipped={index % 2 === 1}
            onPress={() => router.push({ pathname: '/catalog/[id]', params: { id: item.id } })}
          />
        </Animated.View>
      )}
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
    gap: 12,
    paddingHorizontal: 32,
  },
  centered: {
    textAlign: 'center',
  },
  content: {
    gap: 20,
  },
  header: {
    gap: 16,
  },
  // The same row as on Inspiration.
  recreate: {
    marginTop: 16,
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
    paddingVertical: 8,
  },
  recreateText: {
    flex: 1,
    gap: 2,
  },
  recreateTitle: {
    fontFamily: fonts.displayLight,
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
    textAlign: 'left',
  },
});

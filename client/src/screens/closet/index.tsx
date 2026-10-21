import { ITEM_CATEGORIES, type Item } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, {
  Extrapolation,
  FadeIn,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/components/tab-bar';
import { deleteItem, listItems, sessionHeaders } from '@/lib/api';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

import { ClosetCard } from './card';
import { CategoryFilter, type Filter } from './category-filter';
import { NewIn } from './new-in';

const PHOTO_POLL_MS = 1500;
// The cut-out follows a few seconds after the photo. A new item without one is checked again
// for this long; after that removal is off or failed, and the photo stays as it is.
const CUTOUT_WAIT_MS = 20_000;

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: Item[] };

// The first screenful staggers in on the first load, one after another, slowly; later cards and
// reloads just appear.
const STAGGERED = 8;
const STAGGER_STEP = 110;
// From this many items the newest gets the bright block above the grid.
const NEW_IN_FROM = 6;

export function Closet() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [state, setState] = useState<State>({ status: 'loading' });
  // Photos are served by the API to their owner only, so the image requests carry the session cookie.
  const [headers, setHeaders] = useState<Record<string, string>>();
  const [editing, setEditing] = useState(false);
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set());
  const [entered, setEntered] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const scrollY = useSharedValue(0);

  const load = useCallback(async () => {
    try {
      const items = await listItems();
      setState({ status: 'ready', items });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  // Reload whenever the tab comes into view, e.g. after adding an item, and leave edit mode
  // when it goes out of view. The callback may only return a cleanup function, not a promise.
  useFocusEffect(
    useCallback(() => {
      void load();
      return () => setEditing(false);
    }, [load]),
  );

  useEffect(() => {
    // An effect can't be async itself, so the async work goes in an inner function.
    const loadHeaders = async () => {
      try {
        setHeaders(await sessionHeaders());
      } catch {
        setHeaders({});
      }
    };
    void loadHeaders();
  }, []);

  // The server shrinks new photos in the background, usually within a second or two, then
  // removes their background. While any is still processing, or a new one has no cut-out yet,
  // check again shortly; each load schedules the next one.
  useEffect(() => {
    const now = Date.now();
    const waiting =
      state.status === 'ready' &&
      state.items.some(
        (item) =>
          item.photoStatus === 'processing' ||
          (item.photoStatus === 'ready' &&
            !item.cutoutUrl &&
            now - Date.parse(item.createdAt) < CUTOUT_WAIT_MS),
      );
    if (!waiting) return;
    const timer = setTimeout(() => void load(), PHOTO_POLL_MS);
    return () => clearTimeout(timer);
  }, [state, load]);

  // Once the first cards have played their entrance, cards mounted later (scrolling, reloads) skip it.
  const ready = state.status === 'ready';
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setEntered(true), STAGGERED * STAGGER_STEP + durations.enter);
    return () => clearTimeout(timer);
  }, [ready]);

  const items = state.status === 'ready' ? state.items : [];
  // Nothing left to edit: leave edit mode by itself.
  const isEditing = editing && items.length > 0;
  // Chips only for categories the closet has, in the canonical order. If the last item of the
  // chosen category is deleted, the filter falls back to everything.
  const categories = ITEM_CATEGORIES.filter((c) => items.some((item) => item.category === c));
  const activeFilter = filter !== 'all' && categories.includes(filter) ? filter : 'all';
  const visible =
    activeFilter === 'all' ? items : items.filter((item) => item.category === activeFilter);

  // The card disappears once the server confirms, so a failed delete never hides an item.
  // It fades out first and only then leaves the list.
  const remove = async (id: string) => {
    try {
      await deleteItem(id);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      setLeaving((current) => new Set(current).add(id));
      setTimeout(() => {
        setState((current) =>
          current.status === 'ready'
            ? { status: 'ready', items: current.items.filter((item) => item.id !== id) }
            : current,
        );
        setLeaving((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }, durations.leave);
    } catch {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert(t('closet.deleteError'));
    }
  };

  const confirmDelete = (item: Item) => {
    Alert.alert(t('closet.deleteTitle', { name: item.name }), t('closet.deleteMessage'), [
      { text: t('closet.cancel'), style: 'cancel' },
      { text: t('closet.delete'), style: 'destructive', onPress: () => void remove(item.id) },
    ]);
  };

  // A long press is a shortcut into edit mode, the way it is on the home screen.
  const startEditing = () => {
    if (isEditing) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setEditing(true);
  };

  const editButton = items.length > 0 && (
    <Pressable
      style={styles.editButton}
      onPress={() => setEditing(!isEditing)}
      hitSlop={8}
      accessibilityRole="button"
    >
      <Text style={styles.editButtonText}>{t(isEditing ? 'closet.done' : 'closet.edit')}</Text>
    </Pressable>
  );

  // The big title scrolls away; a frosted bar with the small one comes in over the grid.
  const bar = useAnimatedStyle(() => ({
    opacity: interpolate(scrollY.get(), [60, 120], [0, 1], Extrapolation.CLAMP),
  }));
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollY.set(event.contentOffset.y);
  });
  // A closet of a few items has nothing to feature; the banner would only repeat the grid.
  const newest = activeFilter === 'all' && items.length >= NEW_IN_FROM ? items[0] : undefined;

  const listHeader = (
    <>
      <View style={[styles.header, { paddingTop: insets.top + 24 }]}>
        <View style={styles.heading}>
          <Text style={styles.title} accessibilityRole="header">
            {t('closet.title')}
          </Text>
          {items.length > 0 && (
            <Text style={styles.count}>{t('items.count', { count: items.length })}</Text>
          )}
        </View>
        {editButton}
      </View>
      {newest && !isEditing && (
        <NewIn
          item={newest}
          headers={headers}
          onPress={() => router.push({ pathname: '/item/[id]', params: { id: newest.id } })}
        />
      )}
      {/* A single category has nothing to filter. */}
      {categories.length > 1 && (
        <CategoryFilter categories={categories} value={activeFilter} onChange={setFilter} />
      )}
    </>
  );

  return (
    <View style={styles.screen}>
      {state.status === 'loading' && (
        <View style={[styles.center, { paddingTop: insets.top }]}>
          <ActivityIndicator color={colors.accent} />
        </View>
      )}

      {state.status === 'error' && (
        <View style={styles.center}>
          <Text style={styles.message}>{t('closet.loadError')}</Text>
          <Pressable
            onPress={() => {
              setState({ status: 'loading' });
              void load();
            }}
            accessibilityRole="button"
          >
            <Text style={styles.link}>{t('closet.retry')}</Text>
          </Pressable>
        </View>
      )}

      {state.status === 'ready' && items.length === 0 && (
        <>
          {listHeader}
          <Animated.View style={styles.center} entering={FadeIn.duration(durations.enter)}>
            <Text style={styles.message}>{t('closet.empty')}</Text>
          </Animated.View>
        </>
      )}

      {items.length > 0 && (
        // Keyed by the filter: a new filter brings a fresh grid that fades in, instead of cards
        // jumping between rows. The first load has its own staggered entrance.
        <Animated.FlatList
          key={activeFilter}
          entering={entered ? FadeIn.duration(durations.enter) : undefined}
          data={visible}
          keyExtractor={(item) => item.id}
          numColumns={2}
          ListHeaderComponent={listHeader}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          onScroll={onScroll}
          scrollEventThrottle={16}
          extraData={{ isEditing, leaving, headers }}
          renderItem={({ item, index }) => (
            <ClosetCard
              item={item}
              headers={headers}
              editing={isEditing}
              leaving={leaving.has(item.id)}
              enterDelay={!entered && index < STAGGERED ? index * STAGGER_STEP : undefined}
              onPress={
                isEditing
                  ? undefined
                  : () => router.push({ pathname: '/item/[id]', params: { id: item.id } })
              }
              onLongPress={startEditing}
              onDelete={() => confirmDelete(item)}
            />
          )}
        />
      )}

      {/* Decoration only: the big title above is the heading screen readers get. */}
      <Animated.View
        style={[styles.bar, { height: insets.top + 48 }, bar]}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <BlurView
          intensity={70}
          tint="light"
          experimentalBlurMethod="dimezisBlurView"
          style={[StyleSheet.absoluteFill, styles.barGlass]}
        />
        <View style={[styles.barRow, { paddingTop: insets.top }]}>
          <Text style={styles.barTitle}>{t('closet.title')}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingBottom: 18,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
  },
  heading: {
    flex: 1,
    gap: 4,
  },
  title: {
    fontFamily: fonts.displayLight,
    fontSize: 48,
    lineHeight: 50,
    color: colors.text,
    textAlign: 'left',
  },
  count: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'left',
  },
  editButton: {
    minHeight: 44,
    justifyContent: 'center',
  },
  editButtonText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.text,
    textDecorationLine: 'underline',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  link: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.accent,
    textDecorationLine: 'underline',
  },
  grid: {
    paddingHorizontal: 10,
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: 10,
  },
  row: {
    gap: 10,
  },
  // The frosted bar over the grid once the big title has scrolled away.
  bar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
  },
  barGlass: {
    backgroundColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(0, 0, 0, 0.06)',
  },
  barRow: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  barTitle: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.text,
  },
});

import type { ItemCategory } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ScreenTitle } from '@/components/maison';
import { RailLine } from '@/components/rail-line';
import { arrive, durations, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { ClosetCard } from './card';
import { useCloset } from './use-closet';

// The first screenful staggers in, one card after another.
const STAGGERED = 8;

// "See all" from a closet rail: every piece of one category as a two-column grid, with the
// closet's own edit mode. The grid hangs under the category's rail: its one thread, so that's where
// the bead runs while the closet loads (docs/design.md, "Waiting").
export function ClosetCategory({ category }: { category: ItemCategory }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, items, headers, leaving, retry, confirmDelete } = useCloset();
  const [editing, setEditing] = useState(false);
  const [entered, setEntered] = useState(false);

  useFocusEffect(useCallback(() => () => setEditing(false), []));

  const pieces = items.filter((item) => item.category === category);
  const ready = state.status === 'ready';
  const empty = ready && pieces.length === 0;
  // The last piece was deleted (here or elsewhere): the category has nothing left to show.
  useEffect(() => {
    if (empty && router.canGoBack()) router.back();
  }, [empty, router]);

  // Once the first screenful has settled in, a card mounted later (scrolled back to) skips it.
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => setEntered(true), STAGGERED * STAGGER_STEP + durations.arrive);
    return () => clearTimeout(timer);
  }, [ready]);

  const isEditing = editing && pieces.length > 0;

  return (
    <FlatList
      style={styles.screen}
      data={pieces}
      keyExtractor={(item) => item.id}
      numColumns={2}
      columnWrapperStyle={styles.row}
      contentContainerStyle={styles.grid}
      extraData={{ isEditing, leaving, headers }}
      ListHeaderComponent={
        <View>
          <View style={styles.header}>
            <View style={styles.heading}>
              {/* The count's line is kept while waiting, so the rail doesn't move when it comes. */}
              <ScreenTitle
                title={t(`closet.filters.${category}`)}
                subtitle={ready ? t('items.count', { count: pieces.length }) : ' '}
              />
            </View>
            {pieces.length > 0 && (
              <Animated.View entering={arrive}>
                <Pressable
                  style={styles.editButton}
                  onPress={() => setEditing(!isEditing)}
                  hitSlop={8}
                  accessibilityRole="button"
                >
                  <Text style={styles.editButtonText}>
                    {t(isEditing ? 'closet.done' : 'closet.edit')}
                  </Text>
                </Pressable>
              </Animated.View>
            )}
          </View>
          <RailLine waiting={state.status === 'loading'} style={styles.railLine} />
        </View>
      }
      ListEmptyComponent={
        state.status === 'error' ? (
          <Animated.View style={styles.center} entering={arrive}>
            <Text style={styles.message}>
              {t(state.offline ? 'common.offline' : 'closet.loadError')}
            </Text>
            <Pressable onPress={retry} accessibilityRole="button">
              <Text style={styles.link}>{t('closet.retry')}</Text>
            </Pressable>
          </Animated.View>
        ) : empty ? (
          <Animated.View style={styles.center} entering={arrive}>
            <Text style={styles.message}>{t('closet.emptyCategory')}</Text>
          </Animated.View>
        ) : undefined
      }
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
          onLongPress={() => {
            if (isEditing) return;
            void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setEditing(true);
          }}
          onDelete={() => confirmDelete(item)}
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 16,
    paddingHorizontal: 6,
    paddingBottom: 8,
  },
  heading: {
    flex: 1,
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
  grid: {
    paddingHorizontal: 10,
    paddingBottom: 48,
    gap: 10,
  },
  row: {
    gap: 10,
  },
  // Across from the title's rail to the screen's edges, past the grid's padding.
  railLine: {
    marginHorizontal: -10,
    marginTop: 8,
    marginBottom: 8,
  },
  // In the list, which doesn't stretch it: a space above rather than centred.
  center: {
    alignItems: 'center',
    gap: 12,
    paddingTop: 96,
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
});

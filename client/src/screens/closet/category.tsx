import type { ItemCategory } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { HangerLoader } from '@/components/hanger-loader';
import { ScreenTitle } from '@/components/maison';
import { STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { ClosetCard } from './card';
import { useCloset } from './use-closet';

// The first screenful staggers in, one card after another.
const STAGGERED = 8;

// "See all" from a closet rail: every piece of one category as a two-column grid, with the
// closet's own edit mode.
export function ClosetCategory({ category }: { category: ItemCategory }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { state, items, headers, leaving, retry, confirmDelete } = useCloset();
  const [editing, setEditing] = useState(false);

  useFocusEffect(useCallback(() => () => setEditing(false), []));

  const pieces = items.filter((item) => item.category === category);
  const empty = state.status === 'ready' && pieces.length === 0;
  // The last piece was deleted (here or elsewhere): the category has nothing left to show.
  useEffect(() => {
    if (empty && router.canGoBack()) router.back();
  }, [empty, router]);

  if (state.status !== 'ready') {
    return (
      <View style={styles.center}>
        {state.status === 'loading' ? (
          <HangerLoader />
        ) : (
          <>
            <Text style={styles.message}>{t('closet.loadError')}</Text>
            <Pressable onPress={retry} accessibilityRole="button">
              <Text style={styles.link}>{t('closet.retry')}</Text>
            </Pressable>
          </>
        )}
      </View>
    );
  }

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
        <View style={styles.header}>
          <View style={styles.heading}>
            <ScreenTitle
              title={t(`closet.filters.${category}`)}
              subtitle={t('items.count', { count: pieces.length })}
            />
          </View>
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
        </View>
      }
      renderItem={({ item, index }) => (
        <ClosetCard
          item={item}
          headers={headers}
          editing={isEditing}
          leaving={leaving.has(item.id)}
          enterDelay={index < STAGGERED ? index * STAGGER_STEP : undefined}
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
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: colors.background,
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

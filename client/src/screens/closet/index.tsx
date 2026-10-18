import type { Item } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { absoluteUrl, deleteItem, listItems, sessionHeaders } from '@/lib/api';
import { colors, fonts } from '@/theme';

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; items: Item[] };

export function Closet() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [state, setState] = useState<State>({ status: 'loading' });
  // Photos are served by the API to their owner only, so the image requests carry the session cookie.
  const [headers, setHeaders] = useState<Record<string, string>>();

  const load = useCallback(async () => {
    try {
      const items = await listItems();
      setState({ status: 'ready', items });
    } catch {
      setState({ status: 'error' });
    }
  }, []);

  // Reload whenever the tab comes into view, e.g. after adding an item.
  // The callback may only return a cleanup function, not a promise, hence the wrapper.
  useFocusEffect(
    useCallback(() => {
      void load();
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

  // The card disappears once the server confirms, so a failed delete never hides an item.
  const remove = async (id: string) => {
    try {
      await deleteItem(id);
      setState((current) =>
        current.status === 'ready'
          ? { status: 'ready', items: current.items.filter((item) => item.id !== id) }
          : current,
      );
    } catch {
      Alert.alert(t('closet.deleteError'));
    }
  };

  const confirmDelete = (item: Item) => {
    Alert.alert(t('closet.deleteTitle', { name: item.name }), t('closet.deleteMessage'), [
      { text: t('closet.cancel'), style: 'cancel' },
      { text: t('closet.delete'), style: 'destructive', onPress: () => void remove(item.id) },
    ]);
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 24 }]}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">
          {t('closet.title')}
        </Text>
        <Link href="/add-item" asChild>
          <Pressable style={styles.addButton} accessibilityRole="button">
            <Text style={styles.addButtonText}>{t('closet.add')}</Text>
          </Pressable>
        </Link>
      </View>

      {state.status === 'loading' && (
        <ActivityIndicator style={styles.center} color={colors.accent} />
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

      {state.status === 'ready' && state.items.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.message}>{t('closet.empty')}</Text>
        </View>
      )}

      {state.status === 'ready' && state.items.length > 0 && (
        <FlatList
          data={state.items}
          keyExtractor={(item) => item.id}
          numColumns={2}
          columnWrapperStyle={styles.row}
          contentContainerStyle={styles.grid}
          renderItem={({ item }) => (
            // Long press asks to delete. Screen readers get the same as a named action,
            // since they can't discover a gesture.
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              onLongPress={() => confirmDelete(item)}
              accessibilityActions={[{ name: 'delete', label: t('closet.delete') }]}
              onAccessibilityAction={(event) => {
                if (event.nativeEvent.actionName === 'delete') confirmDelete(item);
              }}
            >
              {item.photoUrl && headers ? (
                <Image
                  source={{ uri: absoluteUrl(item.photoUrl), headers }}
                  style={styles.photo}
                  contentFit="cover"
                  transition={150}
                  accessibilityIgnoresInvertColors
                />
              ) : (
                <View style={styles.photo} />
              )}
              <Text style={styles.name} numberOfLines={2}>
                {item.name}
              </Text>
              <Text style={styles.category}>{t(`categories.${item.category}`)}</Text>
            </Pressable>
          )}
        />
      )}
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
    paddingHorizontal: 22,
    paddingBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    flexShrink: 1,
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  addButton: {
    height: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  addButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.onAccent,
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
  },
  grid: {
    paddingHorizontal: 16,
    paddingBottom: 24,
    gap: 16,
  },
  row: {
    gap: 12,
  },
  card: {
    flex: 1,
    gap: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  photo: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: 16,
    backgroundColor: colors.hero,
  },
  name: {
    marginTop: 4,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
  },
  category: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'left',
  },
});

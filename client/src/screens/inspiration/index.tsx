import type { Inspiration as SavedLook } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_CLEARANCE } from '@/components/tab-bar';
import { HangerLoader } from '@/components/hanger-loader';
import { PressableScale } from '@/components/pressable-scale';
import {
  absoluteUrl,
  deleteInspiration,
  listInspiration,
  sessionHeaders,
  uploadPhoto,
} from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText } from '@/lib/limits';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

// Looks picked at once from the gallery, and saved a few at a time.
const MAX_PICKED = 20;
const PARALLEL_UPLOADS = 3;

// Inspiration: looks the user saved because they like them. Saving is free (no model reads a
// look on its own); the style brief reads the newest ones, so outfits learn her taste from them.
export function Inspiration() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const [looks, setLooks] = useState<SavedLook[] | null>(null);
  // Local photos on their way up, shown greyed out in the grid until the list catches up.
  const [saving, setSaving] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Record<string, string>>();

  const load = useCallback(async () => {
    try {
      setLooks(await listInspiration());
    } catch {
      setLooks((current) => current ?? []);
    }
  }, []);

  // Reloads when the tab comes into view, like the closet.
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

  async function add() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: MAX_PICKED,
      orderedSelection: true,
    });
    if (result.canceled) return;
    setMessage(null);
    const assets = result.assets;
    setSaving(assets.map((asset) => asset.uri));
    const lang = appLanguage(i18n.language);

    // A few workers take the photos in order; a limit stops the rest.
    let next = 0;
    let stopped = false;
    const worker = async () => {
      while (!stopped && next < assets.length) {
        const asset = assets[next++]!;
        try {
          await uploadPhoto(await shrinkPhoto(asset), lang, 'inspiration');
        } catch (cause) {
          const code = limitReached(cause);
          if (code) {
            stopped = true;
            setMessage(limitText(t, i18n.language, code));
          } else if (__DEV__) console.warn('Saving a look failed', cause);
        }
        setSaving((current) => current.filter((uri) => uri !== asset.uri));
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, assets.length) }, worker));
    setSaving([]);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    // The server makes the WebP in the background: a moment later the looks are listed.
    setTimeout(() => void load(), 1500);
  }

  function confirmDelete(look: SavedLook) {
    Alert.alert(t('inspiration.deleteTitle'), undefined, [
      { text: t('closet.cancel'), style: 'cancel' },
      {
        text: t('inspiration.delete'),
        style: 'destructive',
        onPress: async () => {
          setLooks((current) => current?.filter((l) => l.key !== look.key) ?? null);
          try {
            await deleteInspiration(look.key);
          } catch {
            void load();
          }
        },
      },
    ]);
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('inspiration.title')}
      </Text>
      <Text style={styles.intro}>{t('inspiration.intro')}</Text>

      <PressableScale
        style={styles.button}
        onPress={add}
        disabled={saving.length > 0}
        accessibilityRole="button"
      >
        {saving.length > 0 ? (
          <ActivityIndicator color={colors.onAccent} />
        ) : (
          <Text style={styles.buttonText}>{t('inspiration.add')}</Text>
        )}
      </PressableScale>
      <Text style={styles.note}>{message ?? t('inspiration.taste')}</Text>

      {looks === null ? (
        <View style={styles.loading}>
          <HangerLoader />
        </View>
      ) : (
        <View style={styles.grid}>
          {saving.map((uri) => (
            <View key={uri} style={styles.cell}>
              <Image source={{ uri }} style={[styles.image, styles.pending]} contentFit="cover" />
            </View>
          ))}
          {looks.map((look, index) => (
            <Animated.View
              key={look.key}
              style={styles.cell}
              entering={FadeIn.duration(durations.enter).delay(Math.min(index, 12) * 30)}
            >
              <PressableScale
                style={styles.cellPress}
                onLongPress={() => confirmDelete(look)}
                accessibilityRole="image"
                accessibilityActions={[{ name: 'delete', label: t('inspiration.delete') }]}
                onAccessibilityAction={() => confirmDelete(look)}
              >
                {headers && (
                  <Image
                    source={{ uri: absoluteUrl(look.url), headers }}
                    style={styles.image}
                    contentFit="cover"
                    transition={200}
                    accessibilityIgnoresInvertColors
                  />
                )}
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}

      <Link href="/want-can" asChild>
        <PressableScale style={styles.link} accessibilityRole="link">
          <Text style={styles.linkText}>{t('inspiration.whatIHave')}</Text>
        </PressableScale>
      </Link>
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
    paddingHorizontal: 22,
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: 12,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  intro: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  button: {
    marginTop: 4,
    height: 50,
    borderRadius: 25,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.onAccent,
  },
  note: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  loading: {
    marginTop: 24,
  },
  grid: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  cell: {
    // Three to a row with two 8 px gaps.
    width: '31.8%',
    aspectRatio: 3 / 4,
  },
  cellPress: {
    flex: 1,
  },
  image: {
    flex: 1,
    borderRadius: 14,
    backgroundColor: colors.hero,
  },
  pending: {
    opacity: 0.45,
  },
  link: {
    marginTop: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.accent,
    textDecorationLine: 'underline',
  },
});

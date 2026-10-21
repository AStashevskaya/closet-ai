import type { Inspiration as SavedLook } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { EditorialCover } from '@/components/cover';
import { HangerLoader } from '@/components/hanger-loader';
import { Button, maison, ScreenTitle, SectionLabel } from '@/components/maison';
import { TAB_BAR_CLEARANCE } from '@/components/tab-bar';
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
import { rise, STAGGER_STEP } from '@/motion';
import { colors } from '@/theme';

// Looks picked at once from the gallery, and saved a few at a time.
const MAX_PICKED = 20;
const PARALLEL_UPLOADS = 3;

// Inspiration: looks the user saved because they like them. Saving is free (no model reads a
// look on its own); the style brief reads the newest ones, so outfits learn her taste from them.
export function Inspiration() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
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
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 20 }]}
    >
      <Animated.View entering={rise} style={[maison.gutter, styles.intro]}>
        <ScreenTitle title={t('inspiration.title')} />
        <Text style={maison.body}>{t('inspiration.intro')}</Text>
      </Animated.View>

      {/* Want / Can: what of a look the user already owns, on the screen's cover. */}
      <Animated.View entering={rise.delay(STAGGER_STEP)}>
        <EditorialCover
          eyebrow={t('want.title')}
          title={t('inspiration.wantTitle')}
          text={t('inspiration.wantText')}
        >
          <Button
            label={t('want.pick')}
            onPress={() => router.push('/want-can')}
            style={styles.coverButton}
          />
        </EditorialCover>
      </Animated.View>

      <Animated.View entering={rise.delay(STAGGER_STEP * 2)} style={[maison.gutter, styles.add]}>
        <SectionLabel>{t('inspiration.saved')}</SectionLabel>
        <Button
          kind="outline"
          label={t('inspiration.add')}
          onPress={add}
          busy={saving.length > 0}
        />
        <Text style={[maison.note, styles.centered]}>{message ?? t('inspiration.taste')}</Text>
      </Animated.View>

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
              entering={rise.delay(STAGGER_STEP * 2 + Math.min(index, 8) * STAGGER_STEP)}
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
                    transition={300}
                    accessibilityIgnoresInvertColors
                  />
                )}
              </PressableScale>
            </Animated.View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: TAB_BAR_CLEARANCE,
    gap: 24,
  },
  intro: {
    gap: 12,
  },
  coverButton: {
    marginTop: 12,
  },
  add: {
    gap: 10,
  },
  centered: {
    textAlign: 'center',
  },
  loading: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  // A moodboard: two to a row, 10 px apart, as in the closet.
  grid: {
    paddingHorizontal: 10,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  cell: {
    width: '48.5%',
    aspectRatio: 3 / 4,
  },
  cellPress: {
    flex: 1,
  },
  image: {
    flex: 1,
    backgroundColor: colors.hero,
  },
  pending: {
    opacity: 0.45,
  },
});

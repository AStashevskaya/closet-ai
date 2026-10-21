import type { Item, LimitCode, LookItem, MatchKind } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { ItemPhoto } from '@/components/item-photo';
import { LookCollage } from '@/components/look-collage';
import { PressableScale } from '@/components/pressable-scale';
import { getPhotoState, sessionHeaders, uploadPhoto } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText, useUsage } from '@/lib/limits';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { durations } from '@/motion';
import { LookCrop } from '@/screens/add-look/look-crop';
import { colors, fonts } from '@/theme';

// Finding the items and comparing each with the wardrobe takes 10–20 s; after a minute and a
// half the screen gives up.
const POLL_MS = 1500;
const MAX_POLLS = 60;

type Match = { how: MatchKind; item: Item | null };
type Found = { item: LookItem; match: Match };

// The screenshot picked, uploaded and read: from nothing picked yet to its items and matches.
type Look =
  | { status: 'empty' }
  | { status: 'finding'; uri: string; aspect: number }
  | { status: 'found'; uri: string; aspect: number; photoKey: string; found: Found[] }
  | { status: 'failed'; uri: string; aspect: number };

// "Want / Can": a screenshot of a look someone else wears, split into items, each shown with
// the wardrobe item that is the same or could stand in for it.
export function WantCan() {
  const { t, i18n } = useTranslation();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const [look, setLook] = useState<Look>({ status: 'empty' });
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  // Photos are served by the API to their owner only, so the image requests carry the cookie.
  const [headers, setHeaders] = useState<Record<string, string>>();
  const { usage, refresh: refreshUsage } = useUsage();
  // A limit the last pick ran into (the month's screenshots, or the server's daily stop).
  const [limit, setLimit] = useState<LimitCode | null>(null);
  const left = usage ? Math.max(0, usage.want.limit - usage.want.used) : null;

  useEffect(() => {
    void sessionHeaders().then(setHeaders);
  }, []);

  async function pick() {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'] });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;

    setPhotoKey(null);
    setLimit(null);
    const aspect = asset.width / asset.height;
    let uri = asset.uri;
    try {
      uri = await shrinkPhoto(asset);
      setLook({ status: 'finding', uri, aspect });
      setPhotoKey(await uploadPhoto(uri, lang, 'want'));
      void refreshUsage();
    } catch (cause) {
      const code = limitReached(cause);
      if (code) {
        setLimit(code);
        setLook({ status: 'empty' });
        void refreshUsage();
        return;
      }
      if (__DEV__) console.warn('Uploading the screenshot failed', cause);
      setLook({ status: 'failed', uri, aspect });
    }
  }

  // Polls the screenshot until its items are found and matched.
  useEffect(() => {
    if (!photoKey) return;
    let cancelled = false;

    const poll = async () => {
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        try {
          const state = await getPhotoState(photoKey);
          if (cancelled) return;
          const { lookItems, matches } = state;
          if (state.tagStatus === 'done' && lookItems && matches) {
            const found = lookItems.map((item, index) => ({
              item,
              match: matches[index] ?? { how: 'none' as const, item: null },
            }));
            setLook((current) =>
              current.status === 'finding'
                ? { ...current, status: 'found', photoKey, found }
                : current,
            );
            void Haptics.selectionAsync();
            return;
          }
          if (state.status === 'failed' || state.tagStatus !== 'pending') break;
        } catch {
          // A dropped request is no reason to stop; the next poll tries again.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled) return;
      }
      if (!cancelled) {
        setLook((current) =>
          current.status === 'finding' ? { ...current, status: 'failed' } : current,
        );
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [photoKey]);

  // Wardrobe items that rebuild the look, each once (two pieces can match the same item).
  const mine =
    look.status === 'found'
      ? look.found.flatMap(({ match }) => (match.item ? [match.item] : []))
      : [];
  const owned = mine.length;
  const collage = [...new Map(mine.map((item) => [item.id, item])).values()];

  const pickButton = (label: string, primary: boolean) => (
    <PressableScale
      style={primary ? styles.button : styles.secondaryButton}
      onPress={pick}
      accessibilityRole="button"
    >
      <Text style={primary ? styles.buttonText : styles.secondaryButtonText}>{label}</Text>
    </PressableScale>
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + 24 }]}
    >
      <Text style={styles.title} accessibilityRole="header">
        {t('want.title')}
      </Text>

      {look.status === 'empty' ? (
        <>
          <View style={[styles.photo, styles.photoEmpty]}>
            <Icon name="spark" color={colors.iconMuted} size={34} strokeWidth={1.2} />
          </View>
          <Text style={styles.intro}>{t('want.intro')}</Text>
          {left === 0 || limit ? (
            <Text style={styles.limit} accessibilityRole="alert">
              {limitText(t, i18n.language, limit ?? 'want', usage)}
            </Text>
          ) : (
            pickButton(t('want.pick'), true)
          )}
          {left !== null && left > 0 && !limit && (
            <Text style={styles.left}>{t('limits.left', { left, limit: usage!.want.limit })}</Text>
          )}
        </>
      ) : (
        <Image
          source={{ uri: look.uri }}
          style={styles.photo}
          contentFit="cover"
          transition={250}
        />
      )}

      {/* Keyed by the state, so each message fades in after the last one. */}
      {look.status !== 'empty' && (
        <Animated.View
          key={look.status}
          style={styles.status}
          entering={FadeIn.duration(durations.state)}
          exiting={FadeOut.duration(durations.press)}
          accessibilityLiveRegion="polite"
        >
          {look.status === 'finding' && <ActivityIndicator size="small" color={colors.accent} />}
          <Text style={[styles.statusText, look.status === 'found' && styles.summary]}>
            {look.status === 'finding' && t('want.finding')}
            {look.status === 'failed' && t('want.errors.find')}
            {look.status === 'found' &&
              (look.found.length > 0
                ? t('want.summary', { owned, count: look.found.length })
                : t('want.none'))}
          </Text>
        </Animated.View>
      )}

      {collage.length > 0 && (
        <Animated.View entering={FadeIn.duration(durations.enter)}>
          <LookCollage items={collage} headers={headers} caption={t('want.collage')} />
        </Animated.View>
      )}

      {look.status === 'found' &&
        look.found.map(({ item, match }, index) => {
          const mine = match.item;
          return (
            <Animated.View
              key={`${look.photoKey}-${index}`}
              entering={FadeIn.duration(durations.enter).delay(index * 45)}
            >
              <PressableScale
                style={[styles.row, mine && styles.rowOwned]}
                onPress={mine ? () => router.push(`/item/${mine.id}`) : undefined}
                disabled={!mine}
                accessibilityRole={mine ? 'button' : undefined}
                accessibilityLabel={`${item.name}. ${t(`want.match.${match.how}`)}${mine ? `: ${mine.name}` : ''}`}
              >
                <LookCrop uri={look.uri} aspect={look.aspect} box={item.box} style={styles.crop} />
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={[styles.verdict, mine && styles.verdictOwned]}>
                    {t(`want.match.${mine ? match.how : 'none'}`)}
                  </Text>
                  {mine && (
                    <Text style={styles.mineName} numberOfLines={1}>
                      {mine.name}
                    </Text>
                  )}
                </View>
                {mine ? (
                  <ItemPhoto item={mine} headers={headers} style={styles.crop} />
                ) : (
                  <View style={[styles.crop, styles.missing]}>
                    <Icon name="hanger" color={colors.iconMuted} size={20} strokeWidth={1.2} />
                  </View>
                )}
              </PressableScale>
            </Animated.View>
          );
        })}

      {(look.status === 'found' || look.status === 'failed') && (
        <View style={styles.again}>
          {left === 0 ? (
            <Text style={styles.limit}>{limitText(t, i18n.language, 'want', usage)}</Text>
          ) : (
            pickButton(t('want.pickAnother'), false)
          )}
          {left !== null && left > 0 && (
            <Text style={styles.left}>{t('limits.left', { left, limit: usage!.want.limit })}</Text>
          )}
        </View>
      )}
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
    paddingBottom: 40,
    gap: 10,
  },
  title: {
    marginBottom: 10,
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  photo: {
    alignSelf: 'center',
    width: '55%',
    aspectRatio: 3 / 4,
    borderRadius: 20,
  },
  photoEmpty: {
    backgroundColor: colors.hero,
    alignItems: 'center',
    justifyContent: 'center',
  },
  intro: {
    marginTop: 6,
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 24,
    marginVertical: 4,
  },
  statusText: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  summary: {
    fontFamily: fonts.display,
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
  },
  rowOwned: {
    borderColor: colors.accent,
    backgroundColor: colors.surface,
  },
  crop: {
    width: 64,
    height: 84,
    borderRadius: 12,
  },
  missing: {
    backgroundColor: colors.hero,
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.6,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  verdict: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'left',
  },
  verdictOwned: {
    fontFamily: fonts.bodySemiBold,
    color: colors.accent,
  },
  mineName: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  button: {
    height: 52,
    marginTop: 12,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.onAccent,
  },
  secondaryButton: {
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.accent,
    textAlign: 'center',
  },
  again: {
    marginTop: 18,
    gap: 8,
  },
  left: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'center',
  },
  limit: {
    marginTop: 12,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
});

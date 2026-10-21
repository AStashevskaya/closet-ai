import type { LimitCode, LookItem } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { PressableScale } from '@/components/pressable-scale';
import { askWearWith, getPhotoState, uploadPhoto } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText, useUsage } from '@/lib/limits';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { durations } from '@/motion';
import { LookCrop } from '@/screens/add-look/look-crop';
import { colors, fonts } from '@/theme';

// Finding the items takes a few seconds; after a minute the screen gives up.
const POLL_MS = 1500;
const MAX_POLLS = 40;

// The photo picked, uploaded and read: from nothing picked yet to the items found on it.
type Shot =
  | { status: 'empty' }
  | { status: 'finding'; uri: string; aspect: number }
  | { status: 'found'; uri: string; aspect: number; photoKey: string; items: LookItem[] }
  | { status: 'failed'; uri: string; aspect: number };

// "What do I wear this with?" for an item the user doesn't own (yet): a screenshot or photo,
// the item on it picked when there are several, then the outfits.
export function WearWithPick() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const [shot, setShot] = useState<Shot>({ status: 'empty' });
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  const [limit, setLimit] = useState<LimitCode | null>(null);
  const [busy, setBusy] = useState(false);
  const { usage } = useUsage();
  const left = usage ? Math.max(0, usage.wear_with.limit - usage.wear_with.used) : null;

  async function pick(source: 'camera' | 'library') {
    if (source === 'camera') {
      const { granted } = await ImagePicker.requestCameraPermissionsAsync();
      if (!granted) return;
    }
    const launch =
      source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await launch({ mediaTypes: ['images'] });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;

    setLimit(null);
    setPhotoKey(null);
    const aspect = asset.width / asset.height;
    let uri = asset.uri;
    try {
      uri = await shrinkPhoto(asset);
      setShot({ status: 'finding', uri, aspect });
      setPhotoKey(await uploadPhoto(uri, lang, 'wear'));
    } catch (cause) {
      const code = limitReached(cause);
      if (code) {
        setLimit(code);
        setShot({ status: 'empty' });
        return;
      }
      if (__DEV__) console.warn('Uploading the photo failed', cause);
      setShot({ status: 'failed', uri, aspect });
    }
  }

  async function choose(key: string, index: number) {
    setBusy(true);
    try {
      const { id } = await askWearWith({ photoKey: key, index }, lang);
      void Haptics.selectionAsync();
      router.replace({ pathname: '/wear-with/[id]', params: { id } });
    } catch (cause) {
      setBusy(false);
      const code = limitReached(cause);
      if (code) setLimit(code);
      else {
        if (__DEV__) console.warn('Asking for outfits failed', cause);
        setShot((current) =>
          current.status === 'found' ? { ...current, status: 'failed' } : current,
        );
      }
    }
  }

  // Polls the photo until its items are found; one item goes straight on to the outfits.
  useEffect(() => {
    if (!photoKey) return;
    let cancelled = false;

    const poll = async () => {
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        try {
          const state = await getPhotoState(photoKey);
          if (cancelled) return;
          const items = state.lookItems;
          if (state.tagStatus === 'done' && items) {
            setShot((current) =>
              current.status === 'finding'
                ? { ...current, status: 'found', photoKey, items }
                : current,
            );
            if (items.length === 1) void choose(photoKey, 0);
            else void Haptics.selectionAsync();
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
        setShot((current) =>
          current.status === 'finding' ? { ...current, status: 'failed' } : current,
        );
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
    // choose only reads its arguments and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey]);

  const outOfToday = left === 0 || limit !== null;
  const buttons = outOfToday ? (
    <Text style={styles.limit} accessibilityRole="alert">
      {limitText(t, i18n.language, limit ?? 'wear_with', usage)}
    </Text>
  ) : (
    <View style={styles.photoButtons}>
      <PressableScale
        style={styles.secondaryButton}
        onPress={() => pick('camera')}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryButtonText}>{t('addItem.takePhoto')}</Text>
      </PressableScale>
      <PressableScale
        style={styles.secondaryButton}
        onPress={() => pick('library')}
        disabled={busy}
        accessibilityRole="button"
      >
        <Text style={styles.secondaryButtonText}>{t('addItem.choosePhoto')}</Text>
      </PressableScale>
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {shot.status === 'empty' ? (
        <>
          <View style={[styles.photo, styles.photoEmpty]}>
            <Icon name="spark" color={colors.iconMuted} size={34} strokeWidth={1.2} />
          </View>
          <Text style={styles.intro}>{t('wearWith.intro')}</Text>
          {buttons}
          {left !== null && left > 0 && !limit && (
            <Text style={styles.left}>
              {t('wearWith.left', { left, limit: usage!.wear_with.limit })}
            </Text>
          )}
        </>
      ) : (
        <Image
          source={{ uri: shot.uri }}
          style={styles.photo}
          contentFit="cover"
          transition={250}
        />
      )}

      {shot.status !== 'empty' && (
        <Animated.View
          key={`${shot.status}-${busy}`}
          style={styles.status}
          entering={FadeIn.duration(durations.state)}
          exiting={FadeOut.duration(durations.press)}
          accessibilityLiveRegion="polite"
        >
          {(shot.status === 'finding' || busy) && (
            <ActivityIndicator size="small" color={colors.accent} />
          )}
          <Text style={styles.statusText}>
            {busy && t('wearWith.composing')}
            {!busy && shot.status === 'finding' && t('wearWith.finding')}
            {!busy && shot.status === 'failed' && t('wearWith.notRead')}
            {!busy &&
              shot.status === 'found' &&
              (shot.items.length === 0 ? t('wearWith.none') : t('wearWith.pickOne'))}
          </Text>
        </Animated.View>
      )}

      {limit && shot.status !== 'empty' && (
        <Text style={styles.limit} accessibilityRole="alert">
          {limitText(t, i18n.language, limit, usage)}
        </Text>
      )}

      {shot.status === 'found' &&
        shot.items.length > 1 &&
        shot.items.map((item, index) => (
          <Animated.View
            key={`${shot.photoKey}-${index}`}
            entering={FadeIn.duration(durations.enter).delay(index * 45)}
          >
            <PressableScale
              style={styles.row}
              onPress={() => choose(shot.photoKey, index)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={item.name}
            >
              <LookCrop uri={shot.uri} aspect={shot.aspect} box={item.box} style={styles.crop} />
              <View style={styles.rowText}>
                <Text style={styles.rowName} numberOfLines={2}>
                  {item.name}
                </Text>
                <Text style={styles.rowCategory}>{t(`categories.${item.category}`)}</Text>
              </View>
              <Icon name="chevron" color={colors.iconMuted} size={18} strokeWidth={1.5} />
            </PressableScale>
          </Animated.View>
        ))}

      {(shot.status === 'failed' || (shot.status === 'found' && shot.items.length === 0)) &&
        !busy && <View style={styles.again}>{buttons}</View>}
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
    padding: 22,
    paddingBottom: 40,
    gap: 10,
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
  photoButtons: {
    marginTop: 6,
    flexDirection: 'row',
    gap: 10,
  },
  secondaryButton: {
    flex: 1,
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
  left: {
    marginTop: 4,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  crop: {
    width: 64,
    height: 84,
    borderRadius: 12,
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
  rowCategory: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'left',
  },
  again: {
    marginTop: 18,
  },
});

import type { LimitCode, LookItem, OutfitMood } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Icon } from '@/components/icon';
import { Button } from '@/components/maison';
import { MoodChips } from '@/components/mood-chips';
import { PressableScale } from '@/components/pressable-scale';
import { useAnnounce } from '@/lib/announce';
import { askWearWith, getPhotoState, uploadPhoto } from '@/lib/api';
import { isOffline, limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText, useUsage } from '@/lib/limits';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { arrive, durations, STAGGER_STEP } from '@/motion';
import { LookCrop } from '@/screens/add-look/look-crop';
import { LookThread } from '@/screens/add-look/look-thread';
import { colors, fonts } from '@/theme';

// Finding the items takes a few seconds; after a minute the screen gives up.
const POLL_MS = 1500;
const MAX_POLLS = 40;
// A blip is no reason to stop, but no connection for this many checks in a row (a few seconds) is: the
// screen says so and offers to try again, rather than waiting out the minute.
const MAX_OFFLINE_POLLS = 5;
// The thread here carries no beads: the pieces are the rows under it.
const NO_BEADS: boolean[] = [];

// The photo picked, uploaded and read: from nothing picked yet to the items found on it.
type Shot =
  | { status: 'empty' }
  | { status: 'finding'; uri: string; aspect: number }
  | { status: 'found'; uri: string; aspect: number; photoKey: string; items: LookItem[] }
  // offline: the server couldn't be reached, which is no fault of the photo.
  // `final`: the server has given up on this photo and won't read it again, so only another will do.
  | { status: 'failed'; uri: string; aspect: number; offline: boolean; final?: boolean };

// "What do I wear this with?" for an item the user doesn't own (yet): a screenshot or photo,
// the item on it picked when there are several, then the outfits.
export function WearWithPick() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const [shot, setShot] = useState<Shot>({ status: 'empty' });
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  // Reading the same photo again after a failure.
  const [attempt, setAttempt] = useState(0);
  const [limit, setLimit] = useState<LimitCode | null>(null);
  const [busy, setBusy] = useState(false);
  // The mood asked of the outfits; null for any.
  const [mood, setMood] = useState<OutfitMood | null>(null);
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
      uploadFailed(cause, uri, aspect);
    }
  }

  function uploadFailed(cause: unknown, uri: string, aspect: number) {
    const code = limitReached(cause);
    if (code) {
      setLimit(code);
      setShot({ status: 'empty' });
      return;
    }
    if (__DEV__) console.warn('Uploading the photo failed', cause);
    setShot({ status: 'failed', uri, aspect, offline: isOffline(cause) });
  }

  // The same photo again, from where it stopped: uploaded already, it's read again (which also
  // brings back the choice, or asks about its one piece again); if not, it's sent again.
  async function retry() {
    if (shot.status !== 'failed') return;
    const { uri, aspect } = shot;
    setLimit(null);
    setShot({ status: 'finding', uri, aspect });
    if (photoKey) {
      setAttempt((n) => n + 1);
      return;
    }
    try {
      setPhotoKey(await uploadPhoto(uri, lang, 'wear'));
    } catch (cause) {
      uploadFailed(cause, uri, aspect);
    }
  }

  async function choose(key: string, index: number) {
    setBusy(true);
    try {
      const { id } = await askWearWith(
        mood ? { photoKey: key, index, mood } : { photoKey: key, index },
        lang,
      );
      void Haptics.selectionAsync();
      router.replace({ pathname: '/wear-with/[id]', params: { id } });
    } catch (cause) {
      setBusy(false);
      const code = limitReached(cause);
      if (code) setLimit(code);
      else {
        if (__DEV__) console.warn('Asking for outfits failed', cause);
        setShot((current) =>
          current.status === 'found'
            ? { ...current, status: 'failed', offline: isOffline(cause) }
            : current,
        );
      }
    }
  }

  // Polls the photo until its items are found; one item goes straight on to the outfits.
  useEffect(() => {
    if (!photoKey) return;
    let cancelled = false;

    const poll = async () => {
      // How many polls in a row found the server unreachable.
      let offline = 0;
      let final = false;
      for (let tries = 0; tries < MAX_POLLS; tries++) {
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
          if (state.status === 'failed' || state.tagStatus !== 'pending') {
            final = true;
            break;
          }
          offline = 0;
        } catch (error) {
          // A dropped request is no reason to stop; the next poll tries again.
          offline = isOffline(error) ? offline + 1 : 0;
          if (offline === MAX_OFFLINE_POLLS) break;
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled) return;
      }
      if (!cancelled) {
        setShot((current) =>
          current.status === 'finding'
            ? { ...current, status: 'failed', offline: offline > 0, final }
            : current,
        );
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
    // choose only reads its arguments and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoKey, attempt]);

  // While the pieces are found, and once one's chosen while its outfits are asked for.
  const waiting = shot.status === 'finding' || busy;
  const waitingFor = busy
    ? t('wearWith.composing')
    : shot.status === 'finding'
      ? t('wearWith.finding')
      : null;
  const failedText =
    shot.status === 'failed' ? t(shot.offline ? 'common.offline' : 'wearWith.notRead') : null;
  // One piece goes straight on to its outfits, with nothing to pick here.
  const foundText =
    shot.status !== 'found' || shot.items.length === 1
      ? null
      : t(shot.items.length === 0 ? 'wearWith.none' : 'wearWith.pickOne');
  const statusText = waitingFor ?? failedText ?? foundText;
  useAnnounce(statusText);

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
          <MoodChips mood={mood} onChange={setMood} />
          {buttons}
          {left !== null && left > 0 && !limit && (
            <Text style={styles.left}>
              {t('wearWith.left', { left, limit: usage!.wear_with.limit })}
            </Text>
          )}
        </>
      ) : (
        <>
          {/* One layout while it waits and after (docs/design.md, "Waiting"): the photo and its
              thread stay, and the pieces settle in under them. */}
          <Image
            source={{ uri: shot.uri }}
            style={styles.photo}
            contentFit="cover"
            transition={250}
          />
          {/* The thread from the photo to the pieces found on it, as on a selfie. Solid with the
              bead while it waits; then dashed, as the pieces aren't hers, or the photo wasn't read. */}
          <LookThread state={waiting ? 'waiting' : 'unread'} pieces={NO_BEADS} />
        </>
      )}

      {statusText && (
        <Animated.View
          key={`${shot.status}-${busy}`}
          style={styles.status}
          entering={arrive}
          exiting={FadeOut.duration(durations.press)}
          accessible={waiting}
          accessibilityRole={waiting ? 'progressbar' : undefined}
          accessibilityLabel={waitingFor ?? undefined}
        >
          <Text style={styles.statusText}>{statusText}</Text>
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
            entering={arrive.delay(index * STAGGER_STEP)}
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
        !busy && (
          <Animated.View style={styles.again} entering={arrive}>
            {shot.status === 'failed' && !shot.final && !outOfToday && (
              <Button kind="outline" label={t('wearWith.retry')} onPress={() => void retry()} />
            )}
            {buttons}
          </Animated.View>
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
    padding: 22,
    paddingBottom: 40,
    gap: 10,
  },
  photo: {
    alignSelf: 'center',
    width: '55%',
    aspectRatio: 3 / 4,
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
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    backgroundColor: colors.surface,
  },
  crop: {
    width: 64,
    height: 84,
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
    gap: 10,
  },
});

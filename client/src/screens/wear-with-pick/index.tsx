import type { LimitCode, LookItem, OutfitMood } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut } from 'react-native-reanimated';

import { Button } from '@/components/maison';
import { MoodChips } from '@/components/mood-chips';
import { WantMore } from '@/components/want-more';
import { useAnnounce } from '@/lib/announce';
import { askWearWith, getPhotoState, uploadPhoto } from '@/lib/api';
import { isOffline, limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { alertAskFailed, limitText, missingForAsk, useUsage } from '@/lib/limits';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { arrive, durations } from '@/motion';
import { colors, fonts } from '@/theme';

import { PickRail, type RailPhase } from './pick-rail';

// Finding the items takes a few seconds; after a minute the screen gives up.
const POLL_MS = 1500;
const MAX_POLLS = 40;
// A blip is no reason to stop, but no connection for this many checks in a row (a few seconds) is: the
// screen says so and offers to try again, rather than waiting out the minute.
const MAX_OFFLINE_POLLS = 5;
// The column under the stage; the stage itself runs to the screen's edges.
const GUTTER = 22;

// The photo picked, uploaded and read: from nothing picked yet to the items found on it.
type Shot =
  | { status: 'empty' }
  | { status: 'finding'; uri: string; aspect: number }
  | { status: 'found'; uri: string; aspect: number; photoKey: string; items: LookItem[] }
  // offline: the server couldn't be reached, which is no fault of the photo.
  // `final`: the server has given up on this photo and won't read it again, so only another will do.
  | { status: 'failed'; uri: string; aspect: number; offline: boolean; final?: boolean };

// Where the stage stands for a shot. One piece goes straight on, so it stays as it was found; with a
// limit reached on it the photo comes back. Several stay hanging, so she still sees what was found.
function railPhase(shot: Shot, busy: boolean, limit: LimitCode | null): RailPhase {
  if (shot.status !== 'found') return shot.status;
  if (shot.items.length === 0) return 'failed';
  if (shot.items.length === 1) return limit ? 'failed' : 'finding';
  return busy ? 'chosen' : 'picking';
}

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
  // The piece tapped, while its outfits are asked for.
  const [chosen, setChosen] = useState<number | null>(null);
  // Two taps in one frame, before the buttons are disabled, would ask twice.
  const asking = useRef(false);
  // The camera was refused: without saying so, the button would look broken.
  const [cameraDenied, setCameraDenied] = useState(false);
  // The camera or the gallery wouldn't open, which isn't a refusal: settings wouldn't help.
  const [pickerFailed, setPickerFailed] = useState<'camera' | 'library' | null>(null);
  // Left the screen while the outfits are asked for: the answer mustn't replace wherever she went.
  // Set in the effect too, as Strict Mode runs the cleanup once before the screen is really gone.
  const onScreen = useRef(true);
  useEffect(() => {
    onScreen.current = true;
    return () => {
      onScreen.current = false;
    };
  }, []);
  // The photo as picked, to shrink again on a retry.
  const picked = useRef<ImagePicker.ImagePickerAsset | null>(null);
  const shrunk = useRef<string | null>(null);
  // The mood asked of the outfits; null for any.
  const [mood, setMood] = useState<OutfitMood | null>(null);
  const { usage } = useUsage();
  const left = usage ? Math.max(0, usage.wear_with.limit - usage.wear_with.used) : null;

  async function pick(source: 'camera' | 'library') {
    setPickerFailed(null);
    let asset: ImagePicker.ImagePickerAsset | undefined;
    try {
      if (source === 'camera') {
        const { granted } = await ImagePicker.requestCameraPermissionsAsync();
        if (!granted) {
          setCameraDenied(true);
          return;
        }
      }
      const launch =
        source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
      const result = await launch({ mediaTypes: ['images'] });
      asset = result.canceled ? undefined : result.assets[0];
    } catch (cause) {
      if (__DEV__) console.warn('Opening the picker failed', cause);
      setPickerFailed(source);
      return;
    }
    if (!asset) return;

    setCameraDenied(false);
    setLimit(null);
    setPhotoKey(null);
    picked.current = asset;
    shrunk.current = null;
    const aspect = asset.width / asset.height;
    let uri = asset.uri;
    try {
      uri = await shrinkPhoto(asset);
      shrunk.current = uri;
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
      // From the picked photo: if shrinking is what failed, `uri` is the original, too big to send.
      shrunk.current ??= picked.current ? await shrinkPhoto(picked.current) : uri;
      setPhotoKey(await uploadPhoto(shrunk.current, lang, 'wear'));
    } catch (cause) {
      uploadFailed(cause, uri, aspect);
    }
  }

  // She may come back with the camera allowed: the camera button is back, and if it's still refused
  // she's told again. Nothing to say if the settings didn't open: the gallery is still there.
  function openSettings() {
    setCameraDenied(false);
    Linking.openSettings().catch(() => undefined);
  }

  async function choose(key: string, index: number) {
    if (asking.current) return;
    asking.current = true;
    setLimit(null);
    setBusy(true);
    setChosen(index);
    try {
      const { id } = await askWearWith(
        mood ? { photoKey: key, index, mood } : { photoKey: key, index },
        lang,
      );
      // The server carries on without her: the styling turns up in her diary when it's done.
      if (!onScreen.current) return;
      void Haptics.selectionAsync();
      router.replace({ pathname: '/wear-with/[id]', params: { id } });
    } catch (cause) {
      asking.current = false;
      setBusy(false);
      setChosen(null);
      const code = limitReached(cause);
      if (code) setLimit(code);
      // Her closet can't make a whole look with this piece: she's told what to add, and the found
      // pieces stay to pick another.
      else if (missingForAsk(cause)) alertAskFailed(t, i18n.language, cause);
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

  const phase = railPhase(shot, busy, limit);
  // While the pieces are found, and once one's chosen while its outfits are asked for.
  const waiting = phase === 'finding' || phase === 'chosen';
  const waitingFor = busy ? t('wearWith.composing') : waiting ? t('wearWith.finding') : null;
  const failedText =
    shot.status === 'failed' ? t(shot.offline ? 'common.offline' : 'wearWith.notRead') : null;
  // One piece goes straight on to its outfits, with nothing to pick here.
  const foundText =
    phase === 'picking' && !limit
      ? t('wearWith.pickOne')
      : shot.status === 'found' && shot.items.length === 0
        ? t('wearWith.none')
        : null;
  const statusText = waitingFor ?? failedText ?? foundText;
  const outOfToday = left === 0 || limit !== null;
  const deniedText = cameraDenied && !outOfToday ? t('wearWith.cameraDenied') : null;
  const pickerFailedText =
    pickerFailed && !outOfToday
      ? t(pickerFailed === 'camera' ? 'wearWith.cameraFailed' : 'wearWith.galleryFailed')
      : null;
  const noteText = pickerFailedText ?? deniedText;
  useAnnounce(noteText ?? statusText);

  const hasPhoto = shot.status !== 'empty';
  // Over a failure "Try again" is the bright one; otherwise the gallery is the main way in.
  const canRetry = shot.status === 'failed' && !shot.final && !outOfToday;
  const buttons = outOfToday ? (
    <>
      <Text style={styles.limit} accessibilityRole="alert">
        {limitText(t, i18n.language, limit ?? 'wear_with', usage)}
      </Text>
      <WantMore code={limit ?? 'wear_with'} />
    </>
  ) : (
    <View style={styles.photoButtons}>
      {deniedText ? (
        <Button
          kind="outline"
          label={t('wearWith.openSettings')}
          onPress={openSettings}
          style={styles.photoButton}
        />
      ) : (
        <Button
          kind="outline"
          label={t('addItem.takePhoto')}
          onPress={() => void pick('camera')}
          disabled={busy}
          style={styles.photoButton}
        />
      )}
      <Button
        kind={canRetry ? 'outline' : 'bright'}
        label={t('addItem.choosePhoto')}
        onPress={() => void pick('library')}
        disabled={busy}
        style={styles.photoButton}
      />
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <PickRail
        phase={phase}
        uri={hasPhoto ? shot.uri : undefined}
        aspect={hasPhoto ? shot.aspect : undefined}
        items={shot.status === 'found' ? shot.items : []}
        chosen={chosen}
        onChoose={(index) => {
          if (shot.status === 'found') void choose(shot.photoKey, index);
        }}
      />

      <View style={styles.under}>
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
            <Text style={phase === 'picking' ? styles.pickText : styles.statusText}>
              {statusText}
            </Text>
          </Animated.View>
        )}

        {/* Stays through a refused camera and a limit, so only what's under it changes. */}
        {phase === 'empty' && (
          <Animated.View style={styles.ask} exiting={FadeOut.duration(durations.press)}>
            <Text style={styles.title} accessibilityRole="header">
              {t('wearWith.ask')}
            </Text>
            <Text style={styles.intro}>{t('wearWith.intro')}</Text>
            {/* The row runs to the screen's edges, past the column's gutter. */}
            <View style={styles.moods}>
              <MoodChips mood={mood} onChange={setMood} inset={GUTTER} />
            </View>
          </Animated.View>
        )}

        {(phase === 'empty' || phase === 'failed' || limit) && (
          <Animated.View
            style={[styles.actions, phase === 'empty' && styles.actionsAtBottom]}
            entering={arrive}
          >
            {noteText && (
              <Text style={styles.denied} accessibilityRole="alert">
                {noteText}
              </Text>
            )}
            {canRetry && (
              <Button kind="bright" label={t('wearWith.retry')} onPress={() => void retry()} />
            )}
            {buttons}
            {phase === 'empty' && !outOfToday && left !== null && left > 0 && (
              <Text style={styles.left}>
                {t('wearWith.left', { left, limit: usage!.wear_with.limit })}
              </Text>
            )}
          </Animated.View>
        )}
      </View>
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
    flexGrow: 1,
    paddingBottom: 40,
  },
  under: {
    flexGrow: 1,
    paddingHorizontal: GUTTER,
    gap: 10,
  },
  ask: {
    gap: 10,
  },
  title: {
    fontFamily: fonts.displayLight,
    fontSize: 27,
    lineHeight: 31,
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
  moods: {
    marginHorizontal: -GUTTER,
    marginTop: 2,
  },
  actions: {
    gap: 10,
  },
  // At the bottom of the screen; on a short one the words above push them on, and it scrolls.
  actionsAtBottom: {
    marginTop: 'auto',
    paddingTop: 16,
  },
  photoButtons: {
    flexDirection: 'row',
    gap: 8,
  },
  // Two side by side: less padding than a full-width button, for the long Russian labels.
  photoButton: {
    flex: 1,
    paddingHorizontal: 10,
  },
  left: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    textAlign: 'center',
  },
  limit: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  denied: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  status: {
    minHeight: 24,
    justifyContent: 'center',
  },
  statusText: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  pickText: {
    fontFamily: fonts.displayLight,
    fontSize: 27,
    lineHeight: 31,
    color: colors.text,
    textAlign: 'center',
  },
});

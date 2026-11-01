import type { LimitCode, LookItem } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/icon';
import { Button, maison } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { addLookItems, getPhotoState, uploadPhoto } from '@/lib/api';
import { isOffline, limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText, useUsage } from '@/lib/limits';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { useConfirmLeave } from '@/lib/use-confirm-leave';
import { durations, rise, STAGGER_STEP } from '@/motion';
import {
  HangUp,
  measureBox,
  PHOTO_ASPECT,
  type Box,
  type HangPiece,
} from '@/screens/add-item/hang-up';
import { colors, fonts } from '@/theme';

import { LookCrop } from './look-crop';
import { LookThread } from './look-thread';
import { Marks, rectOf, stageOf, type Rect } from './marks';

// The model takes 5–15 s on a whole outfit; after a minute the screen gives up.
const POLL_MS = 1500;
const MAX_POLLS = 40;

// The photo picked, uploaded and read: from nothing picked yet to the items found on it.
type Look =
  | { status: 'empty' }
  | { status: 'finding'; uri: string; aspect: number }
  | { status: 'found'; uri: string; aspect: number; photoKey: string; items: LookItem[] }
  // offline: the server couldn't be reached, which is no fault of the photo.
  | { status: 'failed'; uri: string; aspect: number; offline: boolean };

type ErrorKey =
  'addLook.errors.save' | 'addLook.errors.keepOne' | 'addItem.errors.cameraPermission';

// "A look from a selfie" (decided 2026-10-31, prototype `~/Desktop/closet/wrinkle-lab/design-adding`,
// the selfie screen, direction "Выбрано"): the photo full-bleed, each piece found looped and
// labelled by hand on it (see ./marks); a tap leaves a piece out; the bead "Add N pieces" at the
// bottom hangs the rest up. Waiting is this same screen, a bead running along the look's thread
// under the photo.
export function AddLook() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const insets = useSafeAreaInsets();
  const { width, height: windowHeight } = useWindowDimensions();
  const [look, setLook] = useState<Look>({ status: 'empty' });
  const [photoKey, setPhotoKey] = useState<string | null>(null);
  // Indexes of the found items to add; all of them to start with.
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);
  const { usage, refresh: refreshUsage } = useUsage();
  // A limit the last pick ran into: the month's selfies, or the server's daily stop.
  const [limit, setLimit] = useState<LimitCode | null>(null);
  const left = usage ? Math.max(0, usage.look.limit - usage.look.used) : null;
  // The photo on screen, where the pieces fly from when they're hung up.
  const photo = useRef<ComponentRef<typeof View>>(null);
  // Added: the pieces are flying to their rail, then the sheet closes.
  const [hanging, setHanging] = useState<HangPiece[] | null>(null);
  // Where the photo sits on the full-width stage, once there is one.
  const stage = look.status === 'empty' ? null : stageOf(look.aspect, width);
  const leave = useConfirmLeave(
    hanging === null && (look.status === 'finding' || look.status === 'found'),
  );

  async function pick(source: 'camera' | 'library') {
    if (source === 'camera') {
      const { granted } = await ImagePicker.requestCameraPermissionsAsync();
      if (!granted) return setError('addItem.errors.cameraPermission');
    }
    const launch =
      source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await launch({ mediaTypes: ['images'] });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;

    setError(null);
    setLimit(null);
    setPhotoKey(null);
    const aspect = asset.width / asset.height;
    let uri = asset.uri;
    try {
      uri = await shrinkPhoto(asset);
      setLook({ status: 'finding', uri, aspect });
      setPhotoKey(await uploadPhoto(uri, lang, 'look'));
      void refreshUsage();
    } catch (cause) {
      const code = limitReached(cause);
      if (code) {
        setLimit(code);
        setLook({ status: 'empty' });
        void refreshUsage();
        return;
      }
      if (__DEV__) console.warn('Uploading the look failed', cause);
      setLook({ status: 'failed', uri, aspect, offline: isOffline(cause) });
    }
  }

  // Polls the look until the model has listed its items.
  useEffect(() => {
    if (!photoKey) return;
    let cancelled = false;

    const poll = async () => {
      // Whether the last poll found the server unreachable.
      let offline = false;
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        try {
          const state = await getPhotoState(photoKey);
          if (cancelled) return;
          const items = state.lookItems;
          if (state.tagStatus === 'done' && items) {
            setPicked(new Set(items.map((_, index) => index)));
            setLook((current) =>
              current.status === 'finding'
                ? { ...current, status: 'found', photoKey, items }
                : current,
            );
            void Haptics.selectionAsync();
            return;
          }
          if (state.status === 'failed' || state.tagStatus !== 'pending') break;
          offline = false;
        } catch (error) {
          // A dropped request is no reason to stop; the next poll tries again.
          offline = isOffline(error);
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled) return;
      }
      if (!cancelled) {
        setLook((current) =>
          current.status === 'finding' ? { ...current, status: 'failed', offline } : current,
        );
      }
    };

    void poll();
    return () => {
      cancelled = true;
    };
  }, [photoKey]);

  function toggle(index: number) {
    if (busy) return;
    void Haptics.selectionAsync();
    setError(null);
    setPicked((current) => {
      const next = new Set(current);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function save() {
    if (look.status !== 'found') return;
    if (picked.size === 0) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      return setError('addLook.errors.keepOne');
    }
    setError(null);
    setBusy(true);
    const chosen = [...picked].sort((a, b) => a - b);
    try {
      await addLookItems({
        photoKey: look.photoKey,
        items: chosen.map((index) => {
          const { name, category, colors: itemColors, seasons } = look.items[index]!;
          return { index, name, category, colors: itemColors, seasons };
        }),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // "Hang it up": each piece flies from its loop to the rail, then the sheet closes.
      const at = await measureBox(photo.current);
      setHanging(
        chosen.map((index) => {
          const item = look.items[index]!;
          return {
            key: String(index),
            photo: (
              <LookCrop uri={look.uri} aspect={look.aspect} box={item.box} style={styles.flying} />
            ),
            from:
              at && stage && frameAround(rectOf(item.box, look.aspect, stage), at, windowHeight),
            category: item.category,
          };
        }),
      );
    } catch (cause) {
      if (__DEV__) console.warn('Adding the look items failed', cause);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('addLook.errors.save');
      setBusy(false);
    }
  }

  const items = look.status === 'found' ? look.items : [];
  // Out of selfies this month: the buttons give way to when they come back.
  const outOfSelfies = left === 0 || limit !== null;
  const leftNote = left !== null && left > 0 && (
    <Text style={styles.left}>{t('limits.left', { left, limit: usage!.look.limit })}</Text>
  );
  const limitNote = outOfSelfies && (
    <Text style={styles.limit} accessibilityRole="alert">
      {limitText(t, i18n.language, limit ?? 'look', usage)}
    </Text>
  );
  // What the photo told: one line under the look's thread, read out when it changes.
  const note =
    look.status === 'finding'
      ? t('addLook.finding')
      : look.status === 'failed'
        ? look.offline
          ? t('common.offline')
          : t('addLook.errors.find')
        : look.status === 'found'
          ? items.length > 0
            ? t('addLook.found', { count: items.length })
            : t('addLook.none')
          : null;
  // Pieces found: the bead adds them. Otherwise (nothing picked yet, or nothing found) the photo
  // buttons take the bottom; while the photo is read the bead is there, off.
  const adding = look.status === 'found' && items.length > 0;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {stage && look.status !== 'empty' ? (
          <View
            ref={photo}
            style={[styles.stage, { width: stage.width, height: stage.height }]}
            collapsable={false}
          >
            <Image
              source={{ uri: look.uri }}
              style={[
                styles.photo,
                {
                  left: stage.left,
                  top: stage.top,
                  width: look.aspect * stage.scale,
                  height: stage.scale,
                },
              ]}
              contentFit="fill"
              transition={250}
              accessibilityIgnoresInvertColors
            />
            {look.status === 'found' && (
              <Marks
                key={look.photoKey}
                items={items}
                aspect={look.aspect}
                stage={stage}
                picked={picked}
                onToggle={toggle}
              />
            )}
          </View>
        ) : (
          <Animated.View entering={rise} style={[styles.stage, styles.empty, { height: width }]}>
            <Icon name="look" color={colors.iconMuted} size={34} strokeWidth={1.2} />
          </Animated.View>
        )}

        <View style={styles.below}>
          {look.status === 'empty' ? (
            <Animated.Text entering={rise.delay(STAGGER_STEP)} style={styles.intro}>
              {t('addLook.intro')}
            </Animated.Text>
          ) : (
            <>
              <LookThread
                state={look.status === 'finding' ? 'waiting' : adding ? 'strung' : 'unread'}
                pieces={items.map((_, index) => picked.has(index))}
              />
              {/* Keyed by the state, so each message fades in after the last one. */}
              <Animated.Text
                key={look.status}
                style={styles.note}
                entering={FadeIn.duration(durations.state)}
                exiting={FadeOut.duration(durations.press)}
                accessibilityLiveRegion="polite"
              >
                {note}
              </Animated.Text>
            </>
          )}

          {/* Another photo, once this one is read and the bead has the bottom. */}
          {adding && !busy && (
            <View style={styles.again}>
              <Text style={styles.againLabel}>{t('addLook.pickAnother')}</Text>
              {limitNote || (
                <View style={styles.links}>
                  <PressableScale
                    style={styles.link}
                    onPress={() => void pick('camera')}
                    accessibilityRole="button"
                  >
                    <Text style={maison.link}>{t('addItem.takePhoto')}</Text>
                  </PressableScale>
                  <PressableScale
                    style={styles.link}
                    onPress={() => void pick('library')}
                    accessibilityRole="button"
                  >
                    <Text style={maison.link}>{t('addItem.choosePhoto')}</Text>
                  </PressableScale>
                </View>
              )}
              {leftNote}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.actions, { paddingBottom: Math.max(insets.bottom, 16) }]}>
        {/* Keyed by the message, so a new error fades in again instead of swapping in place. */}
        {error && (
          <Animated.Text
            key={error}
            style={styles.error}
            entering={FadeIn.duration(durations.state)}
            exiting={FadeOut.duration(durations.press)}
            accessibilityRole="alert"
          >
            {t(error)}
          </Animated.Text>
        )}
        {adding ? (
          <Button
            kind="bright"
            label={t('addLook.add', { count: picked.size })}
            onPress={() => void save()}
            busy={busy && hanging === null}
            disabled={busy}
          />
        ) : look.status === 'finding' ? (
          <Button kind="bright" label={t('addLook.addWaiting')} onPress={() => {}} disabled />
        ) : (
          <>
            {limitNote || (
              <>
                <Button
                  kind="bright"
                  label={t('addItem.takePhoto')}
                  onPress={() => void pick('camera')}
                />
                <Button
                  kind="outline"
                  label={t('addItem.choosePhoto')}
                  onPress={() => void pick('library')}
                />
              </>
            )}
            {leftNote}
          </>
        )}
      </View>

      {hanging && (
        <HangUp
          pieces={hanging}
          caption={t('addLook.hung', { count: hanging.length })}
          onDone={() => leave(() => router.back())}
        />
      )}
    </View>
  );
}

// Where a piece is on screen, as the hung-up photo's frame (PHOTO_ASPECT) around it: the crop
// that flies is fitted into that frame, so it starts at the piece's own size and place. Stage and
// window coordinates are both physical. Null for a piece scrolled out of sight: it then hangs on
// the rail without flying in from off-screen.
function frameAround(rect: Rect, stage: Box, windowHeight: number): Box | null {
  const width = Math.max(rect.width, rect.height * PHOTO_ASPECT);
  const height = width / PHOTO_ASPECT;
  const y = stage.y + rect.top + rect.height / 2 - height / 2;
  if (stage.y + rect.top + rect.height < 0 || stage.y + rect.top > windowHeight) return null;
  return { x: stage.x + rect.left + rect.width / 2 - width / 2, y, width, height };
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingBottom: 24,
  },
  // Full-bleed: the photo, edge to edge, on the studio grey where it doesn't reach.
  stage: {
    width: '100%',
    overflow: 'hidden',
    // The photo's own directions: left / top place it the same in Hebrew (RN swaps left and
    // right in RTL otherwise), so the marks land on the pieces.
    direction: 'ltr',
    backgroundColor: colors.hero,
  },
  // Placed with left / top: photo pixels are never mirrored, and the marks use the same frame.
  photo: {
    position: 'absolute',
  },
  empty: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  below: {
    paddingHorizontal: 20,
    paddingTop: 14,
    gap: 8,
  },
  intro: {
    ...maison.body,
    textAlign: 'center',
  },
  note: {
    ...maison.note,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  again: {
    marginTop: 18,
    alignItems: 'center',
    gap: 2,
  },
  againLabel: {
    ...maison.note,
    textAlign: 'center',
  },
  links: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    columnGap: 20,
  },
  link: {
    minHeight: 44,
    justifyContent: 'center',
  },
  flying: {
    width: '100%',
    height: '100%',
    backgroundColor: 'transparent',
  },
  actions: {
    paddingTop: 12,
    paddingHorizontal: 20,
    gap: 10,
    backgroundColor: colors.background,
  },
  left: {
    ...maison.note,
    textAlign: 'center',
  },
  limit: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
    textAlign: 'left',
  },
});

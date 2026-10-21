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
import { HangerLoader } from '@/components/hanger-loader';
import { PressableScale } from '@/components/pressable-scale';
import { addLookItems, getPhotoState, uploadPhoto } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { limitText, useUsage } from '@/lib/limits';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { useConfirmLeave } from '@/lib/use-confirm-leave';
import { CSS_EASE_OUT, durations } from '@/motion';
import { colors, fonts } from '@/theme';

import { LookCrop } from './look-crop';

// The model takes 5–15 s on a whole outfit; after a minute the screen gives up.
const POLL_MS = 1500;
const MAX_POLLS = 40;

// The photo picked, uploaded and read: from nothing picked yet to the items found on it.
type Look =
  | { status: 'empty' }
  | { status: 'finding'; uri: string; aspect: number }
  | { status: 'found'; uri: string; aspect: number; photoKey: string; items: LookItem[] }
  | { status: 'failed'; uri: string; aspect: number };

type ErrorKey = 'addLook.errors.save' | 'addLook.errors.empty' | 'addItem.errors.cameraPermission';

export function AddLook() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
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
  const leave = useConfirmLeave(look.status === 'finding' || look.status === 'found');

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
      setLook({ status: 'failed', uri, aspect });
    }
  }

  // Polls the look until the model has listed its items.
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

  function toggle(index: number) {
    void Haptics.selectionAsync();
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
      return setError('addLook.errors.empty');
    }
    setError(null);
    setBusy(true);
    try {
      await addLookItems({
        photoKey: look.photoKey,
        items: [...picked]
          .sort((a, b) => a - b)
          .map((index) => {
            const { name, category, colors: itemColors, seasons } = look.items[index]!;
            return { index, name, category, colors: itemColors, seasons };
          }),
      });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      leave(() => router.back());
    } catch (cause) {
      if (__DEV__) console.warn('Adding the look items failed', cause);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setError('addLook.errors.save');
      setBusy(false);
    }
  }

  // Out of selfies this month: the buttons give way to when they come back.
  const outOfSelfies = left === 0 || limit !== null;
  const leftNote = left !== null && left > 0 && (
    <Text style={styles.left}>{t('limits.left', { left, limit: usage!.look.limit })}</Text>
  );
  const photoButtons = outOfSelfies ? (
    <Text style={styles.limit} accessibilityRole="alert">
      {limitText(t, i18n.language, limit ?? 'look', usage)}
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
      {look.status === 'empty' ? (
        <>
          <View style={[styles.photo, styles.photoEmpty]}>
            <Icon name="look" color={colors.iconMuted} size={34} strokeWidth={1.2} />
          </View>
          <Text style={styles.intro}>{t('addLook.intro')}</Text>
          {photoButtons}
          {leftNote}
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
          {look.status === 'finding' && <HangerLoader size="small" />}
          <Text style={styles.statusText}>
            {look.status === 'finding' && t('addLook.finding')}
            {look.status === 'failed' && t('addLook.errors.find')}
            {look.status === 'found' &&
              (look.items.length > 0
                ? t('addLook.found', { count: look.items.length })
                : t('addLook.none'))}
          </Text>
        </Animated.View>
      )}

      {look.status === 'found' &&
        look.items.map((item, index) => {
          const selected = picked.has(index);
          return (
            <Animated.View
              key={`${look.photoKey}-${index}`}
              entering={FadeIn.duration(durations.enter).delay(index * 45)}
            >
              <PressableScale
                style={[styles.row, selected && styles.rowSelected]}
                onPress={() => toggle(index)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={item.name}
              >
                <LookCrop uri={look.uri} aspect={look.aspect} box={item.box} style={styles.crop} />
                <View style={styles.rowText}>
                  <Text style={styles.rowName} numberOfLines={2}>
                    {item.name}
                  </Text>
                  <Text style={styles.rowCategory}>{t(`categories.${item.category}`)}</Text>
                </View>
                <Animated.View
                  style={[
                    styles.check,
                    selected && styles.checkSelected,
                    { transitionProperty: ['backgroundColor', 'borderColor'] },
                    { transitionDuration: durations.state, transitionTimingFunction: CSS_EASE_OUT },
                  ]}
                >
                  {selected && (
                    <Icon name="check" color={colors.onAccent} size={14} strokeWidth={2} />
                  )}
                </Animated.View>
              </PressableScale>
            </Animated.View>
          );
        })}

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

      {look.status === 'found' && look.items.length > 0 && (
        <PressableScale
          style={[styles.button, busy && styles.buttonBusy]}
          onPress={save}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.buttonText}>{t('addLook.add', { count: picked.size })}</Text>
          )}
        </PressableScale>
      )}

      {(look.status === 'found' || look.status === 'failed') && !busy && (
        <View style={styles.again}>
          <Text style={styles.againLabel}>{t('addLook.pickAnother')}</Text>
          {photoButtons}
          {leftNote}
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
    backgroundColor: colors.background,
  },
  rowSelected: {
    borderColor: colors.accent,
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
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkSelected: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  error: {
    marginTop: 8,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
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
  buttonBusy: {
    opacity: 0.8,
  },
  buttonText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 15,
    color: colors.onAccent,
  },
  again: {
    marginTop: 18,
    gap: 4,
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
  againLabel: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.textMuted,
    textAlign: 'center',
  },
});

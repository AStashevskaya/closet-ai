import { ITEM_CATEGORIES, ITEM_COLORS, type ItemCategory, type ItemColor } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { PressableScale } from '@/components/pressable-scale';
import { createItem, uploadPhoto } from '@/lib/api';
import { shrinkPhoto } from '@/lib/shrink-photo';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

import { Chip } from './chip';

const MAX_COLORS = 5;

type ErrorKey =
  | 'addItem.errors.photo'
  | 'addItem.errors.name'
  | 'addItem.errors.category'
  | 'addItem.errors.colors'
  | 'addItem.errors.cameraPermission'
  | 'addItem.errors.save';

export function AddItem() {
  const { t } = useTranslation();
  const router = useRouter();
  // A local JPEG, already shrunk for upload.
  const [photoUri, setPhotoUri] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [category, setCategory] = useState<ItemCategory | null>(null);
  const [itemColors, setItemColors] = useState<ItemColor[]>([]);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [busy, setBusy] = useState(false);

  async function pick(source: 'camera' | 'library') {
    if (source === 'camera') {
      const { granted } = await ImagePicker.requestCameraPermissionsAsync();
      if (!granted) return setError('addItem.errors.cameraPermission');
    }
    // The gallery opens the system photo picker, which needs no permission.
    const launch =
      source === 'camera' ? ImagePicker.launchCameraAsync : ImagePicker.launchImageLibraryAsync;
    const result = await launch({ mediaTypes: ['images'] });
    const asset = result.canceled ? undefined : result.assets[0];
    if (!asset) return;

    setBusy(true);
    try {
      setPhotoUri(await shrinkPhoto(asset));
      setError(null);
    } finally {
      setBusy(false);
    }
  }

  function toggleColor(color: ItemColor) {
    setItemColors((current) =>
      current.includes(color)
        ? current.filter((c) => c !== color)
        : current.length < MAX_COLORS
          ? [...current, color]
          : current,
    );
  }

  function fail(key: ErrorKey) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    setError(key);
  }

  async function save() {
    if (!photoUri) return fail('addItem.errors.photo');
    if (!name.trim()) return fail('addItem.errors.name');
    if (!category) return fail('addItem.errors.category');
    if (itemColors.length === 0) return fail('addItem.errors.colors');

    setError(null);
    setBusy(true);
    try {
      const photoKey = await uploadPhoto(photoUri);
      await createItem({ name: name.trim(), category, colors: itemColors, seasons: [], photoKey });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (cause) {
      // The user sees a generic message; the real error goes to the Metro terminal.
      if (__DEV__) console.warn('Saving the item failed', cause);
      fail('addItem.errors.save');
      setBusy(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // iOS is handled by the ScrollView below; Android still needs the view to shrink.
      behavior={Platform.OS === 'android' ? 'height' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        // iOS insets the scroll view by the keyboard and keeps the focused field above it.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
      >
        {photoUri ? (
          <Image
            source={{ uri: photoUri }}
            style={styles.photo}
            contentFit="cover"
            transition={250}
          />
        ) : (
          <View style={[styles.photo, styles.photoEmpty]} />
        )}

        <View style={styles.photoButtons}>
          <PressableScale
            style={styles.secondaryButton}
            onPress={() => pick('camera')}
            disabled={busy}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryButtonText}>
              {t(photoUri ? 'addItem.changePhoto' : 'addItem.takePhoto')}
            </Text>
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

        <Text style={styles.label}>{t('addItem.name')}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={t('addItem.namePlaceholder')}
          placeholderTextColor={colors.textMuted}
          maxLength={120}
          accessibilityLabel={t('addItem.name')}
        />

        <Text style={styles.label}>{t('addItem.category')}</Text>
        <View style={styles.chips}>
          {ITEM_CATEGORIES.map((c) => (
            <Chip
              key={c}
              label={t(`categories.${c}`)}
              selected={category === c}
              onPress={() => setCategory(c)}
            />
          ))}
        </View>

        <Text style={styles.label}>
          {t('addItem.colors')} <Text style={styles.hint}>· {t('addItem.colorsHint')}</Text>
        </Text>
        <View style={styles.chips}>
          {ITEM_COLORS.map((c) => (
            <Chip
              key={c}
              label={t(`colors.${c}`)}
              color={c}
              selected={itemColors.includes(c)}
              onPress={() => toggleColor(c)}
            />
          ))}
        </View>

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

        <PressableScale
          style={[styles.button, busy && styles.buttonBusy]}
          onPress={save}
          disabled={busy}
          accessibilityRole="button"
        >
          {busy ? (
            <ActivityIndicator color={colors.onAccent} />
          ) : (
            <Text style={styles.buttonText}>{t('addItem.save')}</Text>
          )}
        </PressableScale>
      </ScrollView>
    </KeyboardAvoidingView>
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
    width: '70%',
    aspectRatio: 3 / 4,
    borderRadius: 20,
  },
  photoEmpty: {
    backgroundColor: colors.hero,
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
  label: {
    marginTop: 12,
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
  },
  hint: {
    fontFamily: fonts.body,
    color: colors.textMuted,
  },
  input: {
    height: 52,
    paddingHorizontal: 20,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
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
    marginTop: 16,
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
});

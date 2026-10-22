import {
  BODY_SHAPES,
  PROFILE_COUNTRIES,
  type BodyShape,
  type UserProfile,
} from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { HangerLoader } from '@/components/hanger-loader';
import { Button, maison } from '@/components/maison';
import { getProfile, updateProfile } from '@/lib/api';
import { authClient } from '@/lib/auth-client';
import { colors, fonts } from '@/theme';

// The form's fields, as typed: numbers are text until saved.
type Form = {
  name: string;
  country: string | null;
  city: string;
  birthYear: string;
  heightCm: string;
  bodyShape: BodyShape | null;
  sizeTop: string;
  sizeBottom: string;
  sizeShoes: string;
};

const formOf = (name: string, profile: UserProfile): Form => ({
  name,
  country: profile.country,
  city: profile.city ?? '',
  birthYear: profile.birthYear?.toString() ?? '',
  heightCm: profile.heightCm?.toString() ?? '',
  bodyShape: profile.bodyShape,
  sizeTop: profile.sizeTop ?? '',
  sizeBottom: profile.sizeBottom ?? '',
  sizeShoes: profile.sizeShoes ?? '',
});

const text = (value: string) => value.trim() || null;
// A whole number, or null for an empty field; NaN tells the server's check to refuse it.
const whole = (value: string) => (value.trim() === '' ? null : Number(value.trim()));

// Profile → My profile: name, where the user lives, age, height, silhouette and sizes, all
// optional, and the account itself (sign out, delete). The name is on the account (Better
// Auth); the rest is in /api/profile.
export function ProfileDetails() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // An effect can't be async itself, so the async work goes in an inner function.
    const load = async () => {
      try {
        setForm(formOf(session?.user.name ?? '', await getProfile()));
      } catch {
        setFailed(true);
      }
    };
    void load();
    // Loaded once; the name from the session is only the starting value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const change = (patch: Partial<Form>) =>
    setForm((current) => current && { ...current, ...patch });

  async function save() {
    if (!form) return;
    setBusy(true);
    setFailed(false);
    try {
      await updateProfile({
        country: form.country,
        city: text(form.city),
        birthYear: whole(form.birthYear),
        heightCm: whole(form.heightCm),
        bodyShape: form.bodyShape,
        sizeTop: text(form.sizeTop),
        sizeBottom: text(form.sizeBottom),
        sizeShoes: text(form.sizeShoes),
      });
      const name = form.name.trim();
      if (name && name !== session?.user.name) await authClient.updateUser({ name });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      router.back();
    } catch (cause) {
      if (__DEV__) console.warn('Saving the profile failed', cause);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFailed(true);
      setBusy(false);
    }
  }

  if (!form) {
    return (
      <View style={styles.center}>
        {failed ? <Text style={maison.body}>{t('details.failed')}</Text> : <HangerLoader />}
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
      keyboardDismissMode="interactive"
    >
      <Text style={maison.body}>{t('details.intro')}</Text>

      <Field label={t('details.name')} value={form.name} onChange={(name) => change({ name })} />

      <Text style={styles.label}>{t('details.country')}</Text>
      <View style={styles.chips}>
        {PROFILE_COUNTRIES.map((code) => (
          <Chip
            key={code}
            label={t(`details.countries.${code}`)}
            selected={form.country === code}
            onPress={() => change({ country: form.country === code ? null : code })}
          />
        ))}
      </View>
      <Field
        label={t('details.city')}
        value={form.city}
        onChange={(city) => change({ city })}
        placeholder={t('details.cityPlaceholder')}
      />

      <View style={styles.row}>
        <Field
          label={t('details.birthYear')}
          value={form.birthYear}
          onChange={(birthYear) => change({ birthYear })}
          numeric
        />
        <Field
          label={t('details.height')}
          value={form.heightCm}
          onChange={(heightCm) => change({ heightCm })}
          numeric
        />
      </View>

      <Text style={styles.label}>
        {t('details.bodyShape')} <Text style={styles.hint}>· {t('details.bodyShapeHint')}</Text>
      </Text>
      <View style={styles.chips}>
        {BODY_SHAPES.map((shape) => (
          <Chip
            key={shape}
            label={t(`details.shapes.${shape}`)}
            selected={form.bodyShape === shape}
            onPress={() => change({ bodyShape: form.bodyShape === shape ? null : shape })}
          />
        ))}
      </View>

      <Text style={styles.label}>{t('details.sizes')}</Text>
      <View style={styles.row}>
        <Field
          label={t('details.sizeTop')}
          value={form.sizeTop}
          onChange={(sizeTop) => change({ sizeTop })}
        />
        <Field
          label={t('details.sizeBottom')}
          value={form.sizeBottom}
          onChange={(sizeBottom) => change({ sizeBottom })}
        />
        <Field
          label={t('details.sizeShoes')}
          value={form.sizeShoes}
          onChange={(sizeShoes) => change({ sizeShoes })}
        />
      </View>

      {failed && (
        <Text style={styles.error} accessibilityRole="alert">
          {t('details.failed')}
        </Text>
      )}
      <Button label={t('details.save')} onPress={save} busy={busy} style={styles.save} />

      <View style={styles.account}>
        <Pressable
          style={styles.accountRow}
          onPress={() => authClient.signOut()}
          accessibilityRole="button"
        >
          <Text style={styles.accountText}>{t('auth.signOut')}</Text>
        </Pressable>
        <Pressable
          style={styles.accountRow}
          onPress={() => router.push('/delete-account')}
          accessibilityRole="button"
        >
          <Text style={[styles.accountText, styles.delete]}>{t('deleteAccount.row')}</Text>
        </Pressable>
      </View>
    </ScrollView>
  );
}

type FieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  numeric?: boolean;
};

function Field({ label, value, onChange, placeholder, numeric }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        keyboardType={numeric ? 'number-pad' : 'default'}
        maxLength={numeric ? 4 : 80}
        accessibilityLabel={label}
      />
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: colors.background,
  },
  content: {
    padding: 20,
    paddingBottom: 48,
    gap: 6,
  },
  row: {
    flexDirection: 'row',
    gap: 16,
  },
  field: {
    flex: 1,
  },
  label: {
    marginTop: 14,
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
  },
  hint: {
    fontFamily: fonts.body,
    color: colors.textMuted,
  },
  // Underlined, as everywhere else.
  input: {
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  chips: {
    marginTop: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  error: {
    marginTop: 12,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
    textAlign: 'left',
  },
  save: {
    marginTop: 24,
  },
  // The account under the form, apart from it.
  account: {
    marginTop: 36,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  accountRow: {
    minHeight: 52,
    justifyContent: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  accountText: {
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  delete: {
    color: colors.error,
  },
});

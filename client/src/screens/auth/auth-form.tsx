import { Link } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authClient } from '@/lib/auth-client';
import { colors, fonts } from '@/theme';

// Same limit as Better Auth's default; checked here so the user gets the message without a round trip.
const MIN_PASSWORD_LENGTH = 8;

type Mode = 'sign-in' | 'sign-up';
type ErrorKey =
  | 'auth.errors.required'
  | 'auth.errors.passwordTooShort'
  | 'auth.errors.invalidEmail'
  | 'auth.errors.invalidCredentials'
  | 'auth.errors.userExists'
  | 'auth.errors.network'
  | 'auth.errors.generic';

// Better Auth error codes → translation keys. Anything unknown gets the generic message.
const ERROR_KEYS: Record<string, ErrorKey> = {
  INVALID_EMAIL_OR_PASSWORD: 'auth.errors.invalidCredentials',
  USER_ALREADY_EXISTS: 'auth.errors.userExists',
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: 'auth.errors.userExists',
  PASSWORD_TOO_SHORT: 'auth.errors.passwordTooShort',
  INVALID_EMAIL: 'auth.errors.invalidEmail',
};

export function AuthForm({ mode }: { mode: Mode }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<ErrorKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const isSignUp = mode === 'sign-up';

  async function submit() {
    if (!email.trim() || !password || (isSignUp && !name.trim())) {
      return setError('auth.errors.required');
    }
    if (isSignUp && password.length < MIN_PASSWORD_LENGTH) {
      return setError('auth.errors.passwordTooShort');
    }

    setError(null);
    setSubmitting(true);
    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });

      // On success the session updates and the protected routes in _layout switch screens.
      if (result.error) {
        setError(ERROR_KEYS[result.error.code ?? ''] ?? 'auth.errors.generic');
      }
    } catch {
      // Server errors come back in result.error; a throw means the request never got an answer.
      setError('auth.errors.network');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // iOS is handled by the ScrollView below; Android still needs the view to shrink.
      behavior={Platform.OS === 'android' ? 'height' : undefined}
    >
      {/* Dark icons: the screen is always light pink, even in dark mode. */}
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        // iOS insets the scroll view by the keyboard and keeps the focused field above it.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        bounces={false}
      >
        <View style={[styles.hero, { paddingTop: insets.top + 40 }]}>
          <Text style={styles.wordmark}>{t('app.name')}</Text>
          <Text style={styles.tagline}>{t('app.tagline')}</Text>
        </View>

        <View style={styles.body}>
          <Text style={styles.title} accessibilityRole="header">
            {t(isSignUp ? 'auth.signUpTitle' : 'auth.welcomeTitle')}
          </Text>
          <Text style={[styles.text, styles.intro]}>{t('auth.intro')}</Text>

          <View style={styles.fields}>
            {isSignUp && (
              <TextInput
                style={styles.input}
                placeholder={t('auth.name')}
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                autoComplete="name"
                textContentType="name"
              />
            )}
            <TextInput
              style={styles.input}
              placeholder={t('auth.email')}
              placeholderTextColor={colors.textMuted}
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <TextInput
              style={styles.input}
              placeholder={t('auth.password')}
              placeholderTextColor={colors.textMuted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
            />

            {error && (
              <Text style={[styles.text, styles.error]} accessibilityRole="alert">
                {t(error)}
              </Text>
            )}

            <Pressable
              style={[styles.button, submitting && styles.buttonBusy]}
              onPress={submit}
              disabled={submitting}
              accessibilityRole="button"
            >
              {submitting ? (
                <ActivityIndicator color={colors.onAccent} />
              ) : (
                <Text style={styles.buttonText}>
                  {t(isSignUp ? 'auth.signUp' : 'auth.signIn')}
                </Text>
              )}
            </Pressable>

            <Link href={isSignUp ? '/sign-in' : '/sign-up'} replace style={styles.link}>
              {t(isSignUp ? 'auth.toSignIn' : 'auth.toSignUp')}
            </Link>
          </View>
        </View>
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
  scroll: {
    flexGrow: 1,
    paddingBottom: 32,
  },
  hero: {
    paddingHorizontal: 26,
    paddingBottom: 40,
    gap: 6,
    backgroundColor: colors.hero,
    borderBottomStartRadius: 40,
    borderBottomEndRadius: 40,
  },
  wordmark: {
    fontFamily: fonts.displayLight,
    fontSize: 56,
    lineHeight: 60,
    letterSpacing: 2,
    color: colors.accentDark,
    textAlign: 'left',
  },
  tagline: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10,
    letterSpacing: 2.4,
    textTransform: 'uppercase',
    color: colors.accent,
    textAlign: 'left',
  },
  body: {
    paddingHorizontal: 26,
    paddingTop: 30,
    gap: 8,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'left',
  },
  intro: {
    color: colors.textSecondary,
  },
  fields: {
    marginTop: 18,
    gap: 10,
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
  error: {
    fontFamily: fonts.bodyMedium,
    color: colors.error,
  },
  button: {
    height: 52,
    marginTop: 4,
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
  link: {
    paddingVertical: 12,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.accent,
    textAlign: 'center',
  },
});

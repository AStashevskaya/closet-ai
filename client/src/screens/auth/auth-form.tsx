import { Link } from 'expo-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { authClient } from '@/lib/auth-client';

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
    <View style={styles.container}>
      {isSignUp && (
        <TextInput
          style={styles.input}
          placeholder={t('auth.name')}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          textContentType="name"
        />
      )}
      <TextInput
        style={styles.input}
        placeholder={t('auth.email')}
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
        style={styles.button}
        onPress={submit}
        disabled={submitting}
        accessibilityRole="button"
      >
        {submitting ? (
          <ActivityIndicator color="white" />
        ) : (
          <Text style={styles.buttonText}>{t(isSignUp ? 'auth.signUp' : 'auth.signIn')}</Text>
        )}
      </Pressable>

      <Link href={isSignUp ? '/sign-in' : '/sign-up'} replace style={[styles.text, styles.link]}>
        {t(isSignUp ? 'auth.toSignIn' : 'auth.toSignUp')}
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    paddingVertical: 24,
    gap: 12,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    // textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
    textAlign: 'left',
  },
  text: {
    fontSize: 15,
    textAlign: 'left',
  },
  error: {
    color: '#c62828',
  },
  button: {
    backgroundColor: '#111',
    borderRadius: 8,
    paddingVertical: 12,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '600',
  },
  link: {
    color: '#1565c0',
  },
});

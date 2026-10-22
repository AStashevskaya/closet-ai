import * as Haptics from 'expo-haptics';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, TextInput } from 'react-native';

import { Button, maison } from '@/components/maison';
import { authClient } from '@/lib/auth-client';
import { colors, fonts } from '@/theme';

type ErrorKey = 'deleteAccount.wrongPassword' | 'deleteAccount.failed';

// Deleting the account, as the App Store requires: everything of the user's goes with it
// (the server cascades the rows and deletes the photos). The password confirms it's them.
export function DeleteAccount() {
  const { t } = useTranslation();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const { error: failed } = await authClient.deleteUser({ password });
      if (failed) {
        // Better Auth answers 400 with INVALID_PASSWORD for a wrong password.
        setError(
          failed.code === 'INVALID_PASSWORD'
            ? 'deleteAccount.wrongPassword'
            : 'deleteAccount.failed',
        );
        void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
        setBusy(false);
        return;
      }
      // The session is gone on the server; clearing it here too sends the app to sign-in.
      try {
        await authClient.signOut();
      } catch {
        // Nothing to sign out of any more.
      }
    } catch (cause) {
      if (__DEV__) console.warn('Deleting the account failed', cause);
      setError('deleteAccount.failed');
      setBusy(false);
    }
  }

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets
    >
      <Text style={maison.body}>{t('deleteAccount.text')}</Text>
      <TextInput
        style={styles.input}
        placeholder={t('deleteAccount.password')}
        placeholderTextColor={colors.textMuted}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        autoComplete="current-password"
        textContentType="password"
        accessibilityLabel={t('deleteAccount.password')}
      />
      {error && (
        <Text style={styles.error} accessibilityRole="alert">
          {t(error)}
        </Text>
      )}
      <Button
        label={t('deleteAccount.confirm')}
        onPress={remove}
        disabled={password.length === 0}
        busy={busy}
        style={styles.button}
      />
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
    padding: 20,
    gap: 16,
  },
  // Underlined, as everywhere else.
  input: {
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.error,
    textAlign: 'left',
  },
  button: {
    marginTop: 8,
    backgroundColor: colors.error,
  },
});

import { StatusBar } from 'expo-status-bar';
import { useRef, useState, type ComponentRef } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type LayoutChangeEvent,
  type TextInputProps,
} from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, maison } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { DOT, INDENT, ThreadLine, ThreadStop } from '@/components/thread-stops';
import i18n from '@/i18n';
import { authClient } from '@/lib/auth-client';
import { durations, EASE_OUT, rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { AuthRail } from './auth-rail';

// Same limit as Better Auth's default; checked here so the user gets the message without a round trip.
const MIN_PASSWORD_LENGTH = 8;

type Mode = 'sign-in' | 'sign-up';
type Field = 'name' | 'email' | 'password';
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

// Where each stop's dot sits, so it lines up with the first line of the title, the middle of a
// field and the middle of the button (stops start with 10 pt of padding).
const TITLE_DOT_Y = 10 + 19 - DOT / 2;
const FIELD_DOT_Y = 10 + 23 - DOT / 2;
const BUTTON_DOT_Y = 10 + 4 + 26 - DOT / 2;
// The auth thread and its dots are a touch heavier than the add-item ones (1.2), as they were built.
const WEIGHT = 1.4;
// The white sheet's rounded top, laid over the bottom of the band.
const CAP = 26;

const swap = FadeIn.duration(durations.enter).easing(EASE_OUT);
const leave = FadeOut.duration(durations.state);
const shift = LinearTransition.duration(durations.state).easing(EASE_OUT);

// Sign-up and sign-in (decided 2026-10-31, prototype `~/Desktop/closet/wrinkle-lab/design-adding`,
// "auth", direction "Выбрано"): one powder-blue band (the first screen a new person sees is
// something new arriving) with the wordmark, the tagline in a pill and a rail of swaying hangers;
// then one thread from the title's bead down through the fields to the button, the bead at its
// end. Both routes render this screen, and switching between them happens here rather than by
// navigating, so only the hangers fill or empty and the words change; nothing enters again.
export function AuthForm({ mode: initialMode }: { mode: Mode }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [mode, setMode] = useState(initialMode);
  // Set on the first switch: from then on what changes fades in, before it the entrance shows it.
  const [switched, setSwitched] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [focused, setFocused] = useState<Field | null>(null);
  const [error, setError] = useState<ErrorKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Measured, so the thread runs from the title's bead on the band to the button's.
  const [band, setBand] = useState({ height: 0, titleY: 0 });
  const [end, setEnd] = useState(0);
  const emailRef = useRef<ComponentRef<typeof TextInput>>(null);
  const passwordRef = useRef<ComponentRef<typeof TextInput>>(null);
  const isSignUp = mode === 'sign-up';

  function fail(key: ErrorKey) {
    setError(key);
    // iOS doesn't read out a new alert by itself.
    AccessibilityInfo.announceForAccessibility(t(key));
  }

  async function submit() {
    if (submitting) return;
    // Out of the way, so the error or the running bead is in view.
    Keyboard.dismiss();
    if (!email.trim() || !password || (isSignUp && !name.trim())) {
      return fail('auth.errors.required');
    }
    if (isSignUp && password.length < MIN_PASSWORD_LENGTH) {
      return fail('auth.errors.passwordTooShort');
    }

    setError(null);
    setSubmitting(true);
    try {
      const result = isSignUp
        ? await authClient.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });

      // On success the session updates and the protected routes in _layout switch screens.
      if (result.error) {
        fail(ERROR_KEYS[result.error.code ?? ''] ?? 'auth.errors.generic');
      }
    } catch {
      // Server errors come back in result.error; a throw means the request never got an answer.
      fail('auth.errors.network');
    } finally {
      setSubmitting(false);
    }
  }

  function toggle() {
    setMode(isSignUp ? 'sign-in' : 'sign-up');
    setSwitched(true);
    setError(null);
    // The screen doesn't change under a screen reader's focus (it stays on the link), so say where she is.
    AccessibilityInfo.announceForAccessibility(
      t(isSignUp ? 'auth.welcomeTitle' : 'auth.signUpTitle'),
    );
  }

  // The thread starts under the title's bead and ends in the middle of the button's.
  const reach = band.height - (band.titleY + TITLE_DOT_Y + DOT);
  const length = band.height > 0 && end > 0 ? reach + end : 0;

  function field(which: Field): Partial<TextInputProps> {
    return {
      style: [styles.field, focused === which && styles.fieldFocused],
      placeholderTextColor: colors.textMuted,
      onFocus: () => setFocused(which),
      onBlur: () => setFocused((current) => (current === which ? null : current)),
      editable: !submitting,
    };
  }

  return (
    <KeyboardAvoidingView
      style={styles.screen}
      // iOS is handled by the ScrollView below; Android still needs the view to shrink.
      behavior={Platform.OS === 'android' ? 'height' : undefined}
    >
      {/* Dark icons: the band is always light blue, even in dark mode. */}
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 24 }]}
        keyboardShouldPersistTaps="handled"
        // iOS insets the scroll view by the keyboard and keeps the focused field above it.
        automaticallyAdjustKeyboardInsets
        keyboardDismissMode="interactive"
        bounces={false}
      >
        <View
          style={[styles.band, { paddingTop: insets.top + 20 }]}
          onLayout={(event) => {
            const height = Math.round(event.nativeEvent.layout.height);
            setBand((current) => ({ ...current, height }));
          }}
        >
          <Animated.View entering={rise} style={styles.brand}>
            <Text style={styles.wordmark}>{t('app.name')}</Text>
            <View style={styles.pill}>
              <Text style={styles.tagline}>{t('app.tagline')}</Text>
            </View>
          </Animated.View>

          <Animated.View entering={rise.delay(STAGGER_STEP)}>
            <AuthRail filled={!isSignUp} />
            <Animated.Text key={mode} entering={switched ? swap : undefined} style={styles.caption}>
              {t(isSignUp ? 'auth.railEmpty' : 'auth.railWaiting')}
            </Animated.Text>
          </Animated.View>

          <Animated.View
            entering={rise.delay(STAGGER_STEP * 2)}
            style={styles.column}
            onLayout={(event: LayoutChangeEvent) => {
              const titleY = Math.round(event.nativeEvent.layout.y);
              setBand((current) => ({ ...current, titleY }));
            }}
          >
            <ThreadStop kind="bead" dotY={TITLE_DOT_Y} weight={WEIGHT}>
              <Animated.View key={mode} entering={switched ? swap : undefined}>
                <Text style={styles.title} accessibilityRole="header">
                  {t(isSignUp ? 'auth.signUpTitle' : 'auth.welcomeTitle')}
                </Text>
                {isSignUp && <Text style={[maison.body, styles.intro]}>{t('auth.intro')}</Text>}
              </Animated.View>
            </ThreadStop>
          </Animated.View>
        </View>
        <View style={styles.cap} />

        <Animated.View entering={rise.delay(STAGGER_STEP * 3)} style={styles.column}>
          <ThreadLine top={reach} length={length} waiting={submitting} weight={WEIGHT} follow />

          {isSignUp && (
            <Animated.View entering={switched ? swap : undefined} exiting={leave}>
              <ThreadStop kind={name.trim() ? 'bead' : 'empty'} dotY={FIELD_DOT_Y} weight={WEIGHT}>
                <TextInput
                  {...field('name')}
                  placeholder={t('auth.name')}
                  accessibilityLabel={t('auth.name')}
                  value={name}
                  onChangeText={setName}
                  autoComplete="name"
                  textContentType="name"
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => emailRef.current?.focus()}
                />
              </ThreadStop>
            </Animated.View>
          )}
          <Animated.View layout={shift}>
            <ThreadStop kind={email.trim() ? 'bead' : 'empty'} dotY={FIELD_DOT_Y} weight={WEIGHT}>
              <TextInput
                {...field('email')}
                ref={emailRef}
                placeholder={t('auth.email')}
                accessibilityLabel={t('auth.email')}
                value={email}
                onChangeText={setEmail}
                autoCapitalize="none"
                autoComplete="email"
                keyboardType="email-address"
                textContentType="emailAddress"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
            </ThreadStop>
          </Animated.View>
          <Animated.View layout={shift}>
            <ThreadStop kind={password ? 'bead' : 'empty'} dotY={FIELD_DOT_Y} weight={WEIGHT}>
              <TextInput
                {...field('password')}
                ref={passwordRef}
                placeholder={t('auth.password')}
                accessibilityLabel={t('auth.password')}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoComplete={isSignUp ? 'new-password' : 'current-password'}
                textContentType={isSignUp ? 'newPassword' : 'password'}
                returnKeyType="go"
                onSubmitEditing={() => void submit()}
              />
              {isSignUp && <Text style={styles.hint}>{t('auth.passwordHint')}</Text>}
              {error && (
                <Text style={styles.error} accessibilityRole="alert">
                  {t(error)}
                </Text>
              )}
            </ThreadStop>
          </Animated.View>
          <Animated.View
            layout={shift}
            onLayout={(event) => setEnd(Math.round(event.nativeEvent.layout.y) + BUTTON_DOT_Y)}
          >
            <ThreadStop kind="bead" dotY={BUTTON_DOT_Y} weight={WEIGHT}>
              <Button
                kind="bright"
                label={t(isSignUp ? 'auth.signUp' : 'auth.signIn')}
                onPress={() => void submit()}
                disabled={submitting}
                style={styles.button}
              />
            </ThreadStop>
          </Animated.View>
        </Animated.View>

        <Animated.View entering={rise.delay(STAGGER_STEP * 4)} layout={shift}>
          <PressableScale
            onPress={toggle}
            disabled={submitting}
            style={styles.switch}
            accessibilityRole="link"
            accessibilityLabel={`${t(isSignUp ? 'auth.haveAccount' : 'auth.noAccount')} ${t(
              isSignUp ? 'auth.toSignIn' : 'auth.toSignUp',
            )}`}
          >
            <Text style={styles.switchText}>
              {t(isSignUp ? 'auth.haveAccount' : 'auth.noAccount')}{' '}
              <Text style={styles.switchAction}>
                {t(isSignUp ? 'auth.toSignIn' : 'auth.toSignUp')}
              </Text>
            </Text>
          </PressableScale>
        </Animated.View>
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
  },
  // Powder blue: the first screen a new person sees is something new arriving.
  band: {
    paddingBottom: 34,
    backgroundColor: colors.ground,
  },
  brand: {
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  wordmark: {
    fontFamily: fonts.displayLight,
    fontSize: 40,
    lineHeight: 44,
    // The same Latin wordmark in Hebrew, set in its wider display face, so a little less spacing.
    letterSpacing: i18n.language === 'he' ? 4 : 7,
    color: colors.text,
    textAlign: 'center',
  },
  pill: {
    marginTop: 8,
    paddingVertical: 4,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.text,
  },
  tagline: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text,
    textAlign: 'center',
  },
  caption: {
    marginTop: -26,
    paddingHorizontal: 20,
    fontFamily: fonts.hand,
    // Gveret Levin runs larger than Marck Script.
    fontSize: i18n.language === 'he' ? 15 : 19,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  column: {
    marginHorizontal: 20,
    paddingStart: INDENT,
  },
  title: {
    fontFamily: fonts.displayLight,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  intro: {
    marginTop: 4,
    color: colors.text,
  },
  // The white sheet the fields are on, its rounded top over the band.
  cap: {
    height: CAP,
    marginTop: -CAP,
    borderTopStartRadius: CAP,
    borderTopEndRadius: CAP,
    backgroundColor: colors.background,
  },
  // Underlined in the display face; the one being typed in fills with blue (something being
  // edited right now). The side padding is pulled back out, so the text lines up with the title.
  field: {
    minHeight: 46,
    marginHorizontal: -6,
    paddingHorizontal: 6,
    paddingTop: 8,
    paddingBottom: 6,
    borderBottomWidth: 1.2,
    borderBottomColor: colors.text,
    fontFamily: fonts.displayLight,
    fontSize: 24,
    color: colors.text,
    textAlign: 'left',
  },
  fieldFocused: {
    backgroundColor: colors.ground,
  },
  hint: {
    ...maison.note,
    marginTop: 6,
  },
  error: {
    marginTop: 8,
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    lineHeight: 20,
    color: colors.error,
    textAlign: 'left',
  },
  button: {
    marginTop: 4,
  },
  switch: {
    minHeight: 44,
    marginTop: 6,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  switchText: {
    fontFamily: fonts.body,
    fontSize: 14,
    lineHeight: 20,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  switchAction: {
    fontFamily: fonts.bodyMedium,
    color: colors.text,
    textDecorationLine: 'underline',
  },
});

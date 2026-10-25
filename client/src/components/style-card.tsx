import * as Haptics from 'expo-haptics';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button, maison } from '@/components/maison';
import { limitReached } from '@/lib/api-error';
import { limitText } from '@/lib/limits';
import { useStyle } from '@/lib/style';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

// The "great shopping" card at the top of the closet (decided 2026-10-25): after a day of new
// pieces it offers to update her style, shows that it's being written, then the new summary.
// The brief costs ~10 ¢, so it's written when she wants it rather than on its own.
export function StyleCard() {
  const { t, i18n } = useTranslation();
  const { style, dismissed, asked, updated, update, dismiss, done } = useStyle(i18n.language);
  const [busy, setBusy] = useState(false);

  async function onUpdate() {
    setBusy(true);
    try {
      await update();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      const code = limitReached(cause);
      Alert.alert(code ? limitText(t, i18n.language, code) : t('style.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!style) return null;
  let body: ReactNode = null;

  if (updated && style.summary) {
    body = (
      <>
        <Text style={styles.title}>{t('style.updated')}</Text>
        <Text style={styles.text}>{style.summary}</Text>
        <Button label={t('style.ok')} onPress={done} kind="ink" />
      </>
    );
  } else if (asked && style.updating) {
    body = (
      <>
        <Text style={styles.title}>{t('style.updatingTitle')}</Text>
        <Text style={styles.text}>{t('style.updating')}</Text>
      </>
    );
  } else if (asked) {
    // Asked, and nothing new came back: the job declined (a limit) or the batch failed.
    body = (
      <>
        <Text style={styles.text}>{t('style.failed')}</Text>
        <Button label={t('style.ok')} onPress={done} kind="ink" />
      </>
    );
  } else if (style.suggest && !dismissed) {
    const { items, looks } = style.suggest;
    const added = [
      items > 0 ? t('items.count', { count: items }) : null,
      looks > 0 ? t('style.looks', { count: looks }) : null,
    ]
      .filter(Boolean)
      .join(t('style.and'));
    body = (
      <>
        <Text style={styles.title}>{t('style.shoppingTitle')}</Text>
        <Text style={styles.text}>{t('style.shoppingBody', { added })}</Text>
        <Button label={t('style.update')} onPress={onUpdate} busy={busy} kind="ink" />
        <Pressable onPress={dismiss} hitSlop={8} accessibilityRole="button" style={styles.later}>
          <Text style={maison.link}>{t('style.notNow')}</Text>
        </Pressable>
      </>
    );
  }

  if (!body) return null;
  return (
    <Animated.View entering={FadeIn.duration(durations.enter)} style={maison.gutter}>
      <View style={styles.card} accessibilityRole="summary">
        {body}
      </View>
    </Animated.View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  card: {
    marginBottom: 20,
    padding: 20,
    gap: 12,
    // The one bright colour, kept for editorial moments like this one.
    backgroundColor: colors.highlight,
  },
  title: {
    fontFamily: fonts.display,
    fontSize: 26,
    lineHeight: 30,
    color: colors.text,
    textAlign: 'left',
  },
  text: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 22,
    color: colors.text,
    textAlign: 'left',
  },
  later: {
    alignSelf: 'center',
  },
});

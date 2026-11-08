import * as Haptics from 'expo-haptics';
import { type ReactNode, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { Button, maison } from '@/components/maison';
import { ApiError, OfflineError } from '@/lib/api';
import { limitReached } from '@/lib/api-error';
import { limitText, nextMonthDate } from '@/lib/limits';
import type { StyleCardState } from '@/lib/style';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

// The "great shopping" card at the top of the closet (decided 2026-10-25): after a day of new
// pieces it offers to update her style, shows that it's being written, then the new summary.
// The brief costs ~10 ¢, so it's written when she wants it rather than on its own. The state
// lives in the closet (useStyle), so the card can unmount with a filter or edit mode.
export function StyleCard({
  style,
  dismissed,
  asked,
  updated,
  slow,
  load,
  update,
  dismiss,
  done,
}: StyleCardState) {
  const { t, i18n } = useTranslation();
  const [busy, setBusy] = useState(false);

  async function onUpdate() {
    setBusy(true);
    try {
      await update();
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (cause) {
      const code = limitReached(cause);
      if (code) Alert.alert(limitText(t, i18n.language, code));
      else if (cause instanceof OfflineError) Alert.alert(t('common.offline'));
      // This month's update has gone (a screen out of date): say until when, then show what is.
      else if (cause instanceof ApiError && cause.message === 'style:month') {
        Alert.alert(t('inspiration.teachMonth', { date: nextMonthDate(i18n.language) }));
        void load();
      }
      // Already being written (another tap, another phone), or not allowed now: show what is.
      else if (cause instanceof ApiError && cause.status === 409) void load();
      else Alert.alert(t('style.failed'));
    } finally {
      setBusy(false);
    }
  }

  if (!style) return null;
  let body: ReactNode = null;

  if (updated && style.summary) {
    body = (
      <>
        <Title>{t('style.updated')}</Title>
        <Text style={styles.text}>{style.summary}</Text>
        <Button label={t('style.ok')} onPress={done} kind="ink" />
      </>
    );
  } else if (slow) {
    body = (
      <>
        <Text style={styles.text}>{t('style.slow')}</Text>
        <Button label={t('style.ok')} onPress={done} kind="ink" />
      </>
    );
  } else if (asked && style.updating) {
    body = (
      <>
        <Title>{t('style.updatingTitle')}</Title>
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
    const { items, looks, reactions } = style.suggest;
    // Only what there's some of, the last two joined by "and".
    const parts = [
      items > 0 ? t('items.count', { count: items }) : null,
      looks > 0 ? t('style.looks', { count: looks }) : null,
      reactions > 0 ? t('style.reactions', { count: reactions }) : null,
    ].filter((part) => part !== null);
    const last = parts.pop() ?? '';
    const before = parts.pop();
    const end = before ? t('style.both', { items: before, looks: last }) : last;
    const added = parts.length > 0 ? `${parts[0]}, ${end}` : end;
    body = (
      <>
        <Title>{t(items > 0 || looks > 0 ? 'style.shoppingTitle' : 'style.ratedTitle')}</Title>
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
      {/* Screen readers hear each new state (updating, updated) as it comes. */}
      <View style={styles.card} accessibilityRole="summary" accessibilityLiveRegion="polite">
        {body}
      </View>
    </Animated.View>
  );
}

function Title({ children }: { children: string }) {
  return (
    <Text style={styles.title} accessibilityRole="header">
      {children}
    </Text>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  card: {
    marginBottom: 20,
    padding: 20,
    gap: 12,
    // The one bright colour, kept for editorial moments like this one.
    backgroundColor: colors.ground,
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

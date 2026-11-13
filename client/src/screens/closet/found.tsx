import type { FoundPiece } from '@closet-ai/shared';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as SecureStore from 'expo-secure-store';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AccessibilityInfo,
  Alert,
  I18nManager,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';

import { BarePiece } from '@/components/bare-piece';
import { MiniLook } from '@/components/mini-look';
import { ApiError } from '@/lib/api-error';
import { getFound, wearFound } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { rememberMorning } from '@/lib/morning';
import { arrive, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

// "Look what turned up" (decided 2026-11-12, D with E inside, prototype
// `~/Desktop/closet/wrinkle-lab/design-found`): once a week, on opening the closet, the rail of a
// piece she hasn't touched flips through its hangers and stops on it; a line by hand comes under
// it with a way to what to wear it with, and "a new life for this piece" offers three looks she
// hasn't worn. No day counts, no guilt: a find. The server picks it (GET /api/found); the app
// shows it once for the week it belongs to.

// The week whose find she has been shown, on this phone.
const SHOWN_KEY = 'found-shown';

export function useFound(active: boolean) {
  const { i18n } = useTranslation();
  const lang = appLanguage(i18n.language);
  const [found, setFound] = useState<FoundPiece | null>(null);
  // Asked once while the app runs: a find isn't news twice.
  const asked = useRef(false);

  useFocusEffect(
    useCallback(() => {
      if (!active || asked.current) return;
      asked.current = true;
      // Not dropped on leaving the tab: the answer is kept for when she's back.
      void (async () => {
        try {
          const answer = await getFound(lang);
          if (!answer.piece) return;
          const shown = await SecureStore.getItemAsync(SHOWN_KEY).catch(() => null);
          if (shown !== answer.week) setFound(answer);
        } catch {
          // A bonus: if it can't be read now, it's asked again next time she comes.
          asked.current = false;
        }
      })();
    }, [active, lang]),
  );

  // Said once it has been seen: from then on, not again this week.
  const seen = useCallback(() => {
    if (found) void SecureStore.setItemAsync(SHOWN_KEY, found.week).catch(() => {});
  }, [found]);

  return { found, seen };
}

// Under the rail, by the piece: a short thread down to the line by hand, and the way on.
export function FoundLine({ onOpen }: { onOpen: () => void }) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const nudge = useSharedValue(0);
  useEffect(() => {
    if (reduced) return;
    nudge.set(
      withRepeat(
        withSequence(withTiming(4, { duration: 420 }), withTiming(0, { duration: 420 })),
        -1,
      ),
    );
    return () => cancelAnimation(nudge);
  }, [reduced, nudge]);
  // The arrow points on: towards the end of the line, mirrored in Hebrew.
  const rtl = I18nManager.isRTL;
  const arrow = useAnimatedStyle(() => ({
    transform: [{ translateX: rtl ? -nudge.get() : nudge.get() }, { scaleX: rtl ? -1 : 1 }],
  }));

  return (
    <Animated.View entering={arrive} style={styles.found} testID="found-line">
      <View
        style={styles.foundThread}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
      <Text style={styles.foundHand}>{t('closet.found.line')}</Text>
      <Pressable
        onPress={onOpen}
        style={styles.pill}
        accessibilityRole="button"
        accessibilityLabel={t('closet.found.button')}
        hitSlop={4}
      >
        <Text style={styles.pillText}>{t('closet.found.button')}</Text>
        <Animated.Text
          style={[styles.pillText, arrow]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          →
        </Animated.Text>
      </Pressable>
    </Animated.View>
  );
}

type Props = {
  found: FoundPiece;
  headers: Record<string, string> | undefined;
  visible: boolean;
  onClose: () => void;
};

// "A new life for this piece": the piece on top, three looks she hasn't worn hanging from it on
// threads, each with "I'll wear it", which makes it tomorrow's look of the day (and tomorrow's
// morning note brings the piece up by name). Powder blue only for the header: it's new.
export function FoundSheet({ found, headers, visible, onClose }: Props) {
  const { t, i18n } = useTranslation();
  const lang = appLanguage(i18n.language);
  const [chosen, setChosen] = useState<number | null>(null);
  const [busy, setBusy] = useState<number | null>(null);
  const piece = found.piece!;

  async function wear(index: number) {
    if (busy !== null || chosen !== null) return;
    setBusy(index);
    try {
      const look = found.looks[index]!;
      const { date } = await wearFound(
        lang,
        look.pieces.map((p) => p.id),
      );
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setChosen(index);
      AccessibilityInfo.announceForAccessibility(t('closet.found.worn'));
      await rememberMorning(date, piece.name).catch(() => {});
    } catch (cause) {
      Alert.alert(
        t(
          cause instanceof ApiError && cause.status === 409
            ? 'closet.found.taken'
            : 'closet.found.failed',
        ),
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={onClose}
    >
      <View style={styles.sheet} accessibilityViewIsModal testID="found-sheet">
        <View style={styles.band}>
          <Pressable
            onPress={onClose}
            style={styles.close}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('closet.found.close')}
          >
            <Text style={styles.closeText}>✕</Text>
          </Pressable>
          <Text style={styles.title} accessibilityRole="header">
            {t('closet.found.title')}
          </Text>
          <Text style={styles.name}>{piece.name}</Text>
          <Text style={styles.sub}>{t('closet.found.sub')}</Text>
        </View>
        <View style={styles.hero}>
          <BarePiece item={piece} headers={headers} style={styles.heroPiece} />
          {/* From the piece down to each look: a mobile of threads. */}
          <View
            style={styles.stem}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
          <View
            style={styles.bar}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
        <View style={styles.looks}>
          {found.looks.map((look, i) => (
            <Animated.View
              key={look.pieces.map((p) => p.id).join('|')}
              entering={arrive.delay(i * STAGGER_STEP)}
              style={styles.look}
              accessible={false}
            >
              <View
                style={styles.drop}
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
              />
              <View
                accessible
                accessibilityLabel={t('closet.found.look', {
                  n: i + 1,
                  pieces: look.pieces.map((p) => p.name).join(', '),
                })}
              >
                <MiniLook items={look.pieces} headers={headers} />
              </View>
              {chosen === i ? (
                <Text style={styles.worn}>{t('closet.found.worn')}</Text>
              ) : (
                <Pressable
                  onPress={() => void wear(i)}
                  disabled={chosen !== null || busy !== null}
                  style={[styles.wear, chosen !== null && styles.wearOff]}
                  accessibilityRole="button"
                  accessibilityLabel={t('closet.found.wearLabel', { n: i + 1 })}
                  accessibilityState={{ disabled: chosen !== null, busy: busy === i }}
                >
                  <Text style={styles.wearText}>{t('closet.found.wear')}</Text>
                </Pressable>
              )}
            </Animated.View>
          ))}
        </View>
      </View>
    </Modal>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  found: {
    alignItems: 'center',
    gap: 6,
    marginTop: -4,
    marginBottom: 6,
  },
  foundThread: {
    width: 1.3,
    height: 18,
    backgroundColor: colors.text,
  },
  foundHand: {
    fontFamily: fonts.hand,
    fontSize: 22,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'center',
  },
  pill: {
    minHeight: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.text,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  pillText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
  },
  sheet: {
    flex: 1,
    backgroundColor: colors.background,
  },
  band: {
    backgroundColor: colors.ground,
    paddingHorizontal: 20,
    paddingTop: 22,
    paddingBottom: 18,
    gap: 4,
  },
  close: {
    alignSelf: 'flex-end',
    minWidth: 44,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: {
    fontFamily: fonts.body,
    fontSize: 20,
    color: colors.text,
  },
  title: {
    fontFamily: fonts.hand,
    fontSize: 28,
    lineHeight: 34,
    color: colors.text,
    textAlign: 'left',
  },
  name: {
    fontFamily: fonts.displayLight,
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'left',
  },
  sub: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  hero: {
    alignItems: 'center',
    paddingTop: 20,
  },
  heroPiece: {
    width: 150,
    height: 180,
  },
  stem: {
    width: 1.3,
    height: 28,
    backgroundColor: colors.text,
  },
  // Across the three looks' middles: a third of the width from each side.
  bar: {
    alignSelf: 'stretch',
    marginHorizontal: '16.6%',
    height: 1.3,
    backgroundColor: colors.text,
  },
  looks: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  look: {
    flex: 1,
    alignItems: 'center',
    gap: 10,
  },
  drop: {
    width: 1.3,
    height: 18,
    backgroundColor: colors.text,
  },
  wear: {
    minHeight: 44,
    minWidth: 88,
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
  },
  wearOff: {
    opacity: 0.4,
  },
  wearText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
  },
  worn: {
    minHeight: 44,
    fontFamily: fonts.hand,
    fontSize: 18,
    lineHeight: 44,
    color: colors.text,
    textAlign: 'center',
  },
});

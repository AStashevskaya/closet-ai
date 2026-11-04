import type { Wish, WishAnswer } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { I18nManager, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { Keyframe } from 'react-native-reanimated';

import { BarePiece } from '@/components/bare-piece';
import { Button, maison, ScreenTitle } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { useAnnounce } from '@/lib/announce';
import { answerWish, createItem, getWearWith, listWishes, sessionHeaders } from '@/lib/api';
import { isOffline } from '@/lib/api-error';
import { appLanguage } from '@/lib/app-language';
import { arrive, durations, EASE_OUT, STAGGER_STEP } from '@/motion';
import { ThreadRow, ThreadWaiting } from '@/screens/style-it/thread-row';
import { colors, fonts } from '@/theme';

type State =
  | { status: 'loading' }
  | { status: 'failed'; offline: boolean }
  // `now`: when the list was read, to count each wish's week down from (not read during render).
  // `threadFrom`: the wish that took over the thread the bead ran down, which is there at once.
  | {
      status: 'done';
      wishes: Wish[];
      headers: Record<string, string>;
      now: number;
      threadFrom: string | null;
    };

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7;

// Days of the week to think it over that have passed, from when she'll be asked (0 to 7).
export function daysPassed(askAt: string, now: number) {
  const left = Math.ceil((new Date(askAt).getTime() - now) / DAY);
  return WEEK - Math.min(WEEK, Math.max(0, left));
}

// A kept wish's new week, from now (as the server sets it).
function newWeek() {
  const now = Date.now();
  return { now, askAt: new Date(now + WEEK * DAY).toISOString() };
}

// I18nManager.isRTL is read once: switching to or from Hebrew reloads the app (src/lib/language.ts).
// Bought: it lifts and goes off toward the start, where the closet is; let go: it drops away.
const toCloset = new Keyframe({
  0: { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] },
  40: { opacity: 1, transform: [{ translateX: 0 }, { translateY: -8 }, { scale: 1.03 }] },
  100: {
    opacity: 0,
    transform: [{ translateX: I18nManager.isRTL ? 60 : -60 }, { translateY: -24 }, { scale: 0.85 }],
    easing: EASE_OUT,
  },
}).duration(durations.enter);
const letGo = new Keyframe({
  0: { opacity: 1, transform: [{ translateY: 0 }, { rotate: '0deg' }] },
  100: {
    opacity: 0,
    transform: [{ translateY: 24 }, { rotate: I18nManager.isRTL ? '4deg' : '-4deg' }],
    easing: EASE_OUT,
  },
}).duration(durations.enter);

// Wishes on a dashed thread (decided 2026-10-29: dashed, because they aren't hers yet): each a
// stop with its cut-out, the verdict, and the week to think it over as seven beads. When the week
// is up, the wish sits on the ground colour and asks whether she still wants it: yes keeps it a
// week more, no lets it go, bought adds it to the closet first. Each opens its outfits.
export function Wishes() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const [state, setState] = useState<State>({ status: 'loading' });
  // The answer on its way: it disables the others and picks how the wish leaves.
  const [pending, setPending] = useState<{ id: string; value: WishAnswer } | null>(null);

  const load = useCallback(async () => {
    try {
      const [wishes, headers] = await Promise.all([listWishes(), sessionHeaders()]);
      const now = Date.now();
      setState((current) => ({
        status: 'done',
        wishes,
        headers,
        now,
        threadFrom: current.status === 'done' ? current.threadFrom : (wishes[0]?.id ?? null),
      }));
    } catch (cause) {
      if (__DEV__) console.warn('Loading the wishes failed', cause);
      // A failed reload keeps the wishes already shown; only a first load says it failed.
      setState((current) =>
        current.status === 'done' ? current : { status: 'failed', offline: isOffline(cause) },
      );
    }
  }, []);

  // Reloaded when the screen comes into view: a piece saved from its outfits meanwhile counts.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const retry = () => {
    setState({ status: 'loading' });
    void load();
  };

  const failedText =
    state.status === 'failed' ? t(state.offline ? 'common.offline' : 'wishes.failed') : null;
  useAnnounce(state.status === 'loading' ? t('common.loading') : failedText);

  // The wish whose answer didn't go through, to say so under it.
  const [failed, setFailed] = useState<string | null>(null);

  async function answer(wish: Wish, value: WishAnswer) {
    setPending({ id: wish.id, value });
    setFailed(null);
    try {
      // Bought: into the closet with its crop, which lets the wish go on the server too. Only
      // when it's in the closet already is there a wish left to answer.
      const { addable } =
        value === 'bought' ? await getWearWith(wish.requestId, lang) : { addable: null };
      if (addable) await createItem(addable);
      else await answerWish(wish.id, value);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      // From the state as it is now: the list may have reloaded while this was on its way.
      // A kept wish starts its week again.
      const { now, askAt } = newWeek();
      setState((current) =>
        current.status === 'done'
          ? {
              ...current,
              now,
              wishes:
                value === 'still'
                  ? current.wishes.map((w) => (w.id === wish.id ? { ...w, due: false, askAt } : w))
                  : current.wishes.filter((w) => w.id !== wish.id),
            }
          : current,
      );
    } catch (cause) {
      if (__DEV__) console.warn('Answering the wish failed', cause);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFailed(wish.id);
    } finally {
      setPending(null);
    }
  }

  const wishes = state.status === 'done' ? state.wishes : [];
  const headers = state.status === 'done' ? state.headers : undefined;
  const now = state.status === 'done' ? state.now : 0;
  const threadFrom = state.status === 'done' ? state.threadFrom : null;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* One layout for every state (docs/design.md, "Waiting"): the title stays where it is and the
          wishes settle in under it; nothing here enters again. */}
      <View style={[maison.gutter, styles.header]}>
        <ScreenTitle title={t('wishes.title')} subtitle={t('wishes.subtitle')} />
        {state.status === 'done' && wishes.length === 0 && (
          <Animated.Text style={maison.body} entering={arrive}>
            {t('wishes.intro')}
          </Animated.Text>
        )}
        {failedText && (
          <Animated.View style={styles.failed} entering={arrive}>
            <Text style={maison.body}>{failedText}</Text>
            <Button kind="outline" label={t('closet.retry')} onPress={retry} />
          </Animated.View>
        )}
      </View>

      <View style={styles.thread}>
        {state.status === 'loading' && <ThreadWaiting />}
        {wishes.map((wish, index) => {
          const leaving = pending?.id === wish.id ? pending.value : null;
          const call = wish.call && t(`verdict.${wish.call}`);
          const passed = daysPassed(wish.askAt, now);
          // Not due by the server's clock but no days left by the phone's: no countdown at all,
          // rather than "Time to decide" with nothing to answer.
          const counting = !wish.due && passed < WEEK;
          return (
            <Animated.View
              key={wish.id}
              exiting={leaving === 'bought' ? toCloset : leaving === 'no' ? letGo : undefined}
            >
              {/* Solid while it waited, dashed now: these aren't hers yet. The first stop's thread
                  is the one the bead ran down, so it's there at once. */}
              <ThreadRow
                kind="root"
                dashed
                hollow={!wish.due}
                joined={index > 0}
                last={index === wishes.length - 1}
                delay={index * STAGGER_STEP}
                inPlace={wish.id === threadFrom}
              >
                <Animated.View
                  style={[styles.stop, wish.due && styles.due]}
                  entering={arrive.delay(index * STAGGER_STEP)}
                >
                  <PressableScale
                    style={styles.who}
                    onPress={() =>
                      router.push({ pathname: '/wear-with/[id]', params: { id: wish.requestId } })
                    }
                    accessibilityRole="button"
                    // The label replaces what's inside for screen readers: the verdict and the days
                    // left go into it (the beads are hidden).
                    accessibilityLabel={[
                      wish.name,
                      call,
                      counting && t('wishes.left', { count: WEEK - passed }),
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  >
                    <BarePiece
                      item={wish}
                      headers={headers}
                      style={wish.due ? styles.pieceDue : styles.piece}
                    />
                    <View style={styles.text}>
                      <Text style={[styles.name, wish.due && styles.nameDue]} numberOfLines={3}>
                        {wish.name}
                      </Text>
                      {call && <Text style={styles.call}>{call}</Text>}
                      {counting && <Week passed={passed} />}
                    </View>
                  </PressableScale>

                  {wish.due && (
                    <View style={styles.ask}>
                      <Text style={styles.question}>{t('wishes.ask')}</Text>
                      {call && <Text style={styles.then}>{t('wishes.then', { call })}</Text>}
                      <View style={styles.answers}>
                        {(['still', 'no', 'bought'] as const).map((value) => (
                          <Button
                            key={value}
                            kind={value === 'still' ? 'bright' : 'outline'}
                            label={t(`wishes.${value}`)}
                            onPress={() => void answer(wish, value)}
                            disabled={pending !== null}
                            busy={leaving === value}
                            style={styles.answer}
                          />
                        ))}
                      </View>
                      {failed === wish.id && (
                        <Text style={styles.error} accessibilityRole="alert">
                          {t('wishes.answerFailed')}
                        </Text>
                      )}
                    </View>
                  )}
                </Animated.View>
              </ThreadRow>
            </Animated.View>
          );
        })}
      </View>
    </ScrollView>
  );
}

// The week to think it over: a bead for each day gone, and how many are left in the hand face.
function Week({ passed }: { passed: number }) {
  const { t } = useTranslation();
  const left = WEEK - passed;
  return (
    <View style={styles.week}>
      <View
        style={styles.beads}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {Array.from({ length: WEEK }, (_, day) => (
          <View key={day} style={[styles.bead, day < passed && styles.beadOn]} />
        ))}
      </View>
      <Text style={styles.left}>{t('wishes.left', { count: left })}</Text>
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  failed: {
    gap: 12,
  },
  content: {
    paddingTop: 8,
    paddingBottom: 48,
  },
  header: {
    gap: 14,
    marginBottom: 22,
  },
  thread: {
    paddingStart: 6,
    paddingEnd: 20,
  },
  stop: {
    paddingBottom: 30,
    gap: 14,
  },
  // Time to decide: on the ground colour, so it stands out from the ones still waiting.
  due: {
    padding: 16,
    marginBottom: 30,
    backgroundColor: colors.ground,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  piece: {
    width: 84,
    height: 100,
  },
  pieceDue: {
    width: 112,
    height: 132,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontFamily: fonts.displayLight,
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'left',
  },
  nameDue: {
    fontSize: 28,
    lineHeight: 32,
  },
  call: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  week: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  beads: {
    flexDirection: 'row',
    gap: 5,
  },
  bead: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: colors.text,
  },
  beadOn: {
    backgroundColor: colors.bead,
  },
  left: {
    fontFamily: fonts.hand,
    fontSize: 16,
    color: colors.textMuted,
    textAlign: 'left',
  },
  ask: {
    gap: 6,
  },
  question: {
    fontFamily: fonts.display,
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
    textAlign: 'left',
  },
  then: {
    fontFamily: fonts.hand,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  answers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  answer: {
    minHeight: 44,
    paddingHorizontal: 18,
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.error,
    textAlign: 'left',
  },
});

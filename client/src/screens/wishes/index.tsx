import type { Wish, WishAnswer } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { HangerLoader } from '@/components/hanger-loader';
import { ItemPhoto } from '@/components/item-photo';
import { maison, ScreenTitle } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { answerWish, createItem, getWearWith, listWishes, sessionHeaders } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

type State =
  | { status: 'loading' }
  | { status: 'failed' }
  | { status: 'done'; wishes: Wish[]; headers: Record<string, string> };

// Wishes: pieces the user wants to buy, each with its verdict. A week after saving, the app asks
// whether she still wants it: yes keeps it a week more, no lets it go, bought adds it to the
// closet first. Each opens its outfits.
export function Wishes() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = appLanguage(i18n.language);
  const [state, setState] = useState<State>({ status: 'loading' });
  // The wish being answered.
  const [busy, setBusy] = useState<string | null>(null);

  // Reloaded when the screen comes into view: a piece saved from its outfits meanwhile counts.
  useFocusEffect(
    useCallback(() => {
      const load = async () => {
        try {
          const [wishes, headers] = await Promise.all([listWishes(), sessionHeaders()]);
          setState({ status: 'done', wishes, headers });
        } catch (cause) {
          if (__DEV__) console.warn('Loading the wishes failed', cause);
          setState((current) => (current.status === 'done' ? current : { status: 'failed' }));
        }
      };
      void load();
    }, []),
  );

  // The wish whose answer didn't go through, to say so under it.
  const [failed, setFailed] = useState<string | null>(null);

  async function answer(wish: Wish, value: WishAnswer) {
    setBusy(wish.id);
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
      setState((current) =>
        current.status === 'done'
          ? {
              ...current,
              wishes:
                value === 'still'
                  ? current.wishes.map((w) => (w.id === wish.id ? { ...w, due: false } : w))
                  : current.wishes.filter((w) => w.id !== wish.id),
            }
          : current,
      );
    } catch (cause) {
      if (__DEV__) console.warn('Answering the wish failed', cause);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      setFailed(wish.id);
    } finally {
      setBusy(null);
    }
  }

  if (state.status !== 'done') {
    return (
      <View style={styles.center}>
        {state.status === 'loading' ? (
          <HangerLoader />
        ) : (
          <Text style={[maison.body, styles.centered]}>{t('wishes.failed')}</Text>
        )}
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Animated.View entering={rise} style={styles.header}>
        <ScreenTitle title={t('wishes.title')} subtitle={t('wishes.subtitle')} />
        {state.wishes.length === 0 && <Text style={maison.body}>{t('wishes.intro')}</Text>}
      </Animated.View>

      {state.wishes.map((wish, index) => (
        <Animated.View
          key={wish.id}
          entering={rise.delay((index + 1) * STAGGER_STEP)}
          style={[styles.card, wish.due && styles.cardDue]}
        >
          <PressableScale
            style={styles.row}
            onPress={() =>
              router.push({ pathname: '/wear-with/[id]', params: { id: wish.requestId } })
            }
            accessibilityRole="button"
            accessibilityLabel={wish.name}
          >
            <ItemPhoto
              item={{ photoUrl: wish.photoUrl, cutoutUrl: wish.cutoutUrl ?? undefined }}
              headers={state.headers}
              style={styles.photo}
            />
            <View style={styles.text}>
              <Text style={styles.name} numberOfLines={2}>
                {wish.name}
              </Text>
              {wish.call && <Text style={styles.call}>{t(`verdict.${wish.call}`)}</Text>}
              <Text style={maison.note}>
                {t('wishes.saved', {
                  date: new Date(wish.createdAt).toLocaleDateString(i18n.language, {
                    day: 'numeric',
                    month: 'long',
                  }),
                })}
              </Text>
            </View>
          </PressableScale>

          {wish.due && (
            <View style={styles.ask}>
              <Text style={styles.question}>{t('wishes.ask')}</Text>
              <View style={styles.answers}>
                {(['still', 'no', 'bought'] as const).map((value) => (
                  <PressableScale
                    key={value}
                    style={[
                      styles.answer,
                      value === 'still' && styles.answerYes,
                      busy !== null && styles.answerBusy,
                    ]}
                    onPress={() => answer(wish, value)}
                    disabled={busy !== null}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: busy !== null, busy: busy === wish.id }}
                  >
                    <Text style={[styles.answerText, value === 'still' && styles.answerTextYes]}>
                      {t(`wishes.${value}`)}
                    </Text>
                  </PressableScale>
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
      ))}
    </ScrollView>
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
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  centered: {
    textAlign: 'center',
  },
  content: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 48,
    gap: 14,
  },
  header: {
    gap: 14,
    marginBottom: 8,
  },
  card: {
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // Waiting for an answer: on the studio grey, so it stands out.
  cardDue: {
    paddingHorizontal: 12,
    backgroundColor: colors.hero,
    borderBottomWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  photo: {
    width: 72,
    aspectRatio: 3 / 4,
  },
  text: {
    flex: 1,
    gap: 4,
  },
  name: {
    fontFamily: fonts.bodyMedium,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  call: {
    fontFamily: fonts.displayLight,
    fontSize: 22,
    lineHeight: 26,
    color: colors.text,
    textAlign: 'left',
  },
  ask: {
    gap: 10,
  },
  question: {
    fontFamily: fonts.display,
    fontSize: 20,
    color: colors.text,
    textAlign: 'left',
  },
  answers: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  answer: {
    minHeight: 40,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.text,
    justifyContent: 'center',
    backgroundColor: colors.background,
  },
  answerYes: {
    borderColor: colors.bead,
    backgroundColor: colors.bead,
  },
  answerBusy: {
    opacity: 0.5,
  },
  error: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.error,
    textAlign: 'left',
  },
  answerText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
  },
  answerTextYes: {
    color: colors.onBead,
  },
});

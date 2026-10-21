import type { Outfit, OutfitReaction, WearWithRequest } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';

import { FlatLay } from '@/components/flat-lay';
import { PressableScale } from '@/components/pressable-scale';
import { createItem, getWearWith, reactToOutfit, sessionHeaders } from '@/lib/api';
import { durations } from '@/motion';
import { colors, fonts } from '@/theme';

// The model takes about 10 s; after a minute and a half the screen gives up.
const POLL_MS = 2000;
const MAX_POLLS = 45;

type State =
  | { status: 'pending' }
  | { status: 'failed' }
  | { status: 'done'; outfits: Outfit[]; addable: WearWithRequest['addable'] };

// "What do I wear this with?": the outfits composed around one item, each with its reactions.
export function WearWith({ id }: { id: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<State>({ status: 'pending' });
  const [headers, setHeaders] = useState<Record<string, string>>();

  useEffect(() => {
    // An effect can't be async itself, so the async work goes in an inner function.
    const loadHeaders = async () => {
      try {
        setHeaders(await sessionHeaders());
      } catch {
        setHeaders({});
      }
    };
    void loadHeaders();
  }, []);

  // Polls the request until its outfits are composed.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
        try {
          const request: WearWithRequest = await getWearWith(id);
          if (cancelled) return;
          if (request.status === 'done') {
            setState({ status: 'done', outfits: request.outfits, addable: request.addable });
            void Haptics.selectionAsync();
            return;
          }
          if (request.status === 'failed') break;
        } catch {
          // A dropped request is no reason to stop; the next poll tries again.
        }
        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
        if (cancelled) return;
      }
      if (!cancelled) setState({ status: 'failed' });
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Shown at once; if the server doesn't take it, it goes back.
  async function react(outfit: Outfit, reaction: OutfitReaction) {
    if (state.status !== 'done') return;
    void Haptics.selectionAsync();
    const change = (o: Outfit): Outfit =>
      reaction === 'wore'
        ? { ...o, woreCount: o.woreCount + 1 }
        : { ...o, opinion: reaction === 'none' ? null : reaction };
    const before = state.outfits;
    setState({ ...state, outfits: before.map((o) => (o.id === outfit.id ? change(o) : o)) });
    try {
      await reactToOutfit(outfit.id, reaction);
    } catch {
      setState((current) =>
        current.status === 'done' ? { ...current, outfits: before } : current,
      );
    }
  }

  // An item from a photo, bought or already owned: into the wardrobe with its crop.
  const [adding, setAdding] = useState<'idle' | 'busy' | 'added'>('idle');
  async function addToCloset() {
    if (state.status !== 'done' || !state.addable) return;
    setAdding('busy');
    try {
      await createItem(state.addable);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAdding('added');
    } catch (cause) {
      if (__DEV__) console.warn('Adding the item failed', cause);
      setAdding('idle');
    }
  }

  if (state.status === 'pending') {
    return (
      <View style={styles.center} accessibilityLiveRegion="polite">
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.message}>{t('wearWith.composing')}</Text>
      </View>
    );
  }
  if (state.status === 'failed') {
    return (
      <View style={styles.center}>
        <Text style={styles.message}>{t('wearWith.failed')}</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {state.addable && (
        <PressableScale
          style={[styles.add, adding === 'added' && styles.addDone]}
          onPress={addToCloset}
          disabled={adding !== 'idle'}
          accessibilityRole="button"
        >
          {adding === 'busy' ? (
            <ActivityIndicator color={colors.accent} />
          ) : (
            <Text style={styles.addText}>
              {t(adding === 'added' ? 'wearWith.added' : 'wearWith.add')}
            </Text>
          )}
        </PressableScale>
      )}
      {state.outfits.length === 0 && <Text style={styles.message}>{t('wearWith.empty')}</Text>}
      {state.outfits.map((outfit, index) => {
        const pieces = outfit.pieces.flatMap((p) => (p.item ? [p.item] : []));
        return (
          <Animated.View
            key={outfit.id}
            style={styles.card}
            entering={FadeIn.duration(durations.enter).delay(index * 60)}
          >
            <FlatLay pieces={pieces} headers={headers} caption={outfit.caption} />
            <Text style={styles.occasion}>{outfit.occasion}</Text>
            <Text style={styles.why}>{outfit.why}</Text>
            <Text style={styles.pieces}>{pieces.map((p) => p.name).join(' · ')}</Text>
            {outfit.missing && (
              <View style={styles.missing}>
                <Text style={styles.missingText}>
                  {t('wearWith.missing', { what: outfit.missing.description })}
                </Text>
              </View>
            )}
            <View style={styles.reactions}>
              <Reaction
                label={t('wearWith.like')}
                on={outfit.opinion === 'like'}
                onPress={() => react(outfit, outfit.opinion === 'like' ? 'none' : 'like')}
              />
              <Reaction
                label={t('wearWith.dislike')}
                on={outfit.opinion === 'dislike'}
                onPress={() => react(outfit, outfit.opinion === 'dislike' ? 'none' : 'dislike')}
              />
              <Reaction
                label={
                  outfit.woreCount > 0
                    ? t('wearWith.woreCount', { count: outfit.woreCount })
                    : t('wearWith.wore')
                }
                on={outfit.woreCount > 0}
                onPress={() => react(outfit, 'wore')}
              />
            </View>
          </Animated.View>
        );
      })}
    </ScrollView>
  );
}

function Reaction({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <PressableScale
      style={[styles.reaction, on && styles.reactionOn]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
    >
      <Text style={[styles.reactionText, on && styles.reactionTextOn]}>{label}</Text>
    </PressableScale>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    padding: 22,
    paddingBottom: 48,
    gap: 40,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    paddingHorizontal: 32,
    backgroundColor: colors.background,
  },
  message: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  card: {
    gap: 6,
  },
  add: {
    minHeight: 44,
    marginBottom: -16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addDone: {
    borderColor: colors.border,
  },
  addText: {
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.accent,
  },
  occasion: {
    marginTop: 14,
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    color: colors.textMuted,
    textAlign: 'left',
  },
  why: {
    fontFamily: fonts.display,
    fontSize: 20,
    lineHeight: 26,
    color: colors.text,
    textAlign: 'left',
  },
  pieces: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    textAlign: 'left',
  },
  missing: {
    marginTop: 4,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: colors.hero,
  },
  missingText: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  reactions: {
    marginTop: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  reaction: {
    minHeight: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  reactionOn: {
    borderColor: colors.accent,
    backgroundColor: colors.accent,
  },
  reactionText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
  },
  reactionTextOn: {
    color: colors.onAccent,
  },
});

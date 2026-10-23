import type { Outfit, OutfitReaction, WearWithRequest } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { FlatLay } from '@/components/flat-lay';
import { ItemPhoto } from '@/components/item-photo';
import { HangerLoader } from '@/components/hanger-loader';
import { Button } from '@/components/maison';
import { PartnerPiece } from '@/components/partner-piece';
import { PressableScale } from '@/components/pressable-scale';
import { createItem, getWearWith, reactToOutfit, sessionHeaders } from '@/lib/api';
import { appLanguage } from '@/lib/app-language';
import { rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

// The model takes about 10 s; after a minute and a half the screen gives up.
const POLL_MS = 2000;
const MAX_POLLS = 45;

type State =
  | { status: 'pending' }
  | { status: 'failed' }
  | {
      status: 'done';
      outfits: Outfit[];
      addable: WearWithRequest['addable'];
      verdict: WearWithRequest['verdict'];
    };

// "What do I wear this with?": the outfits composed around one item, each with its reactions.
export function WearWith({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const lang = appLanguage(i18n.language);
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
          const request: WearWithRequest = await getWearWith(id, lang);
          if (cancelled) return;
          if (request.status === 'done') {
            setState({
              status: 'done',
              outfits: request.outfits,
              addable: request.addable,
              verdict: request.verdict,
            });
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
  }, [id, lang]);

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
      // Only this outfit goes back: reactions to the others since then stay.
      const was = before.find((o) => o.id === outfit.id) ?? outfit;
      setState((current) =>
        current.status === 'done'
          ? { ...current, outfits: current.outfits.map((o) => (o.id === outfit.id ? was : o)) }
          : current,
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
        <HangerLoader />
        <Text style={styles.composing}>{t('wearWith.composing')}</Text>
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
      {state.verdict && <Verdict verdict={state.verdict} headers={headers} />}
      {state.addable && (
        <Button
          kind="outline"
          label={t(adding === 'added' ? 'wearWith.added' : 'wearWith.add')}
          onPress={addToCloset}
          disabled={adding === 'added'}
          busy={adding === 'busy'}
        />
      )}
      {state.outfits.length === 0 && <Text style={styles.message}>{t('wearWith.empty')}</Text>}
      {state.outfits.map((outfit, index) => {
        const pieces = outfit.pieces.flatMap((p) => (p.item ? [p.item] : []));
        // At most one, and labelled: a partner brand's piece where the closet had nothing as good.
        const partner = outfit.pieces.find((p) => p.catalogItem)?.catalogItem;
        return (
          <Animated.View
            key={outfit.id}
            style={[styles.card, index > 0 && styles.cardDivider]}
            entering={rise.delay(index * STAGGER_STEP)}
          >
            {/* Numbered like the pages of a lookbook. */}
            <Text style={styles.number}>
              {String(index + 1).padStart(2, '0')} / {String(state.outfits.length).padStart(2, '0')}
            </Text>
            <FlatLay
              pieces={partner ? [...pieces, { ...partner, cutoutUrl: partner.imageUrl }] : pieces}
              headers={headers}
              caption={outfit.caption}
            />
            <Text style={styles.occasion}>{outfit.occasion}</Text>
            <Text style={styles.why}>{outfit.why}</Text>
            <Text style={styles.pieces}>{pieces.map((p) => p.name).join(' · ')}</Text>
            {partner && <PartnerPiece item={partner} headers={headers} />}
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

// Whether a piece she may buy is worth it for her wardrobe: the call, why, and the piece she
// owns that it nearly repeats.
function Verdict({
  verdict,
  headers,
}: {
  verdict: NonNullable<WearWithRequest['verdict']>;
  headers: Record<string, string> | undefined;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  const { call, reason, twin } = verdict;
  return (
    <Animated.View
      entering={rise}
      style={[styles.verdict, call === 'buy' && styles.verdictBuy]}
      accessibilityRole="summary"
    >
      <Text style={styles.verdictTitle}>{t('verdict.title')}</Text>
      <Text style={styles.verdictCall}>{t(`verdict.${call}`)}</Text>
      <Text style={styles.verdictReason}>{reason}</Text>
      {twin && (
        <PressableScale
          style={styles.twin}
          onPress={() => router.push({ pathname: '/item/[id]', params: { id: twin.id } })}
          accessibilityRole="button"
          accessibilityLabel={`${t('verdict.twin')}: ${twin.name}`}
        >
          <ItemPhoto item={twin} headers={headers} style={styles.twinPhoto} />
          <View style={styles.twinText}>
            <Text style={styles.twinLabel}>{t('verdict.twin')}</Text>
            <Text style={styles.twinName} numberOfLines={2}>
              {twin.name}
            </Text>
          </View>
        </PressableScale>
      )}
    </Animated.View>
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
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 48,
    gap: 32,
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
  composing: {
    fontFamily: fonts.displayLight,
    fontSize: 24,
    lineHeight: 30,
    color: colors.text,
    textAlign: 'center',
  },
  card: {
    gap: 8,
  },
  cardDivider: {
    paddingTop: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  number: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textMuted,
    textAlign: 'left',
  },
  occasion: {
    marginTop: 14,
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
    textAlign: 'left',
  },
  why: {
    fontFamily: fonts.displayLight,
    fontSize: 24,
    lineHeight: 30,
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
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  missingText: {
    fontFamily: fonts.body,
    fontSize: 13,
    lineHeight: 18,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  verdict: {
    padding: 18,
    gap: 6,
    backgroundColor: colors.hero,
  },
  // A yes gets the one bright colour.
  verdictBuy: {
    backgroundColor: colors.highlight,
  },
  verdictTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 12,
    color: colors.text,
    textAlign: 'left',
  },
  verdictCall: {
    fontFamily: fonts.displayLight,
    fontSize: 40,
    lineHeight: 44,
    color: colors.text,
    textAlign: 'left',
  },
  verdictReason: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.text,
    textAlign: 'left',
  },
  twin: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  twinPhoto: {
    width: 48,
    aspectRatio: 3 / 4,
  },
  twinText: {
    flex: 1,
    gap: 2,
  },
  twinLabel: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  twinName: {
    fontFamily: fonts.bodyMedium,
    fontSize: 14,
    color: colors.text,
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
    paddingHorizontal: 15,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.textMuted,
    justifyContent: 'center',
  },
  reactionOn: {
    borderColor: colors.highlight,
    backgroundColor: colors.highlight,
  },
  reactionText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  reactionTextOn: {
    color: colors.text,
  },
});

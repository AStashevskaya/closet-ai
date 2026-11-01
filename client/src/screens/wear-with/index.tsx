import type { Item, WearWithRequest } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { BarePiece } from '@/components/bare-piece';
import { Hanger, HANGER_PIVOT_Y, HANGER_WIDTH, HANGERS } from '@/components/hanger';
import { HangerLoader } from '@/components/hanger-loader';
import { Button } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { addWish, createItem, sessionHeaders } from '@/lib/api';
import { isOffline, limitReached } from '@/lib/api-error';
import { limitText } from '@/lib/limits';
import { rise, STAGGER_STEP } from '@/motion';
import { ThreadRow } from '@/screens/style-it/thread-row';
import { colors, fonts } from '@/theme';

import { OutfitCard } from './outfit-card';
import { useWearWith } from './use-wear-with';

// "What do I wear this with?": the outfits composed around one item, each with its reactions.
export function WearWith({ id }: { id: string }) {
  const { t, i18n } = useTranslation();
  const { state, setWishId, react } = useWearWith(id);
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

  // A tap that didn't go through says why: without it the button only came back as it was, as if
  // the tap hadn't registered. A limit reached, no connection, or that it failed.
  function failedText(cause: unknown, fallback: 'wearWith.addFailed' | 'wishes.addFailed') {
    const code = limitReached(cause);
    if (code) return limitText(t, i18n.language, code);
    return isOffline(cause) ? t('common.offline') : t(fallback);
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
      Alert.alert(failedText(cause, 'wearWith.addFailed'));
    }
  }

  // A piece she may buy, into her wishes: asked about again in a week.
  const [wishing, setWishing] = useState(false);
  async function wish() {
    if (state.status !== 'done' || state.wishId) return;
    setWishing(true);
    try {
      const saved = await addWish(id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setWishId(saved.id);
    } catch (cause) {
      if (__DEV__) console.warn('Saving the wish failed', cause);
      Alert.alert(failedText(cause, 'wishes.addFailed'));
    } finally {
      setWishing(false);
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

  // The piece itself: the hero of its outfits; with none (nothing in her closet goes with it), its
  // photo by the request (as the server serves it) and the name it'd be added under.
  const hero =
    state.outfits.flatMap((o) => o.pieces).find((p) => p.hero)?.item ??
    (state.addable && {
      id,
      name: state.addable.name,
      category: state.addable.category,
      photoUrl: `/api/wear-with/${id}/photo`,
    });
  // Nothing to add means it's in her closet already: hers.
  const hers = !state.addable || adding === 'added';
  const { verdict } = state;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* On a thread like Style it's (decided 2026-10-29, prototype
          `~/Desktop/closet/wrinkle-lab/design-photo-outfits`, direction A), dashed while the piece
          isn't hers yet; solid once it's in her closet. */}
      <ThreadRow kind="root" dashed={!hers} hollow={!hers} last={state.outfits.length === 0}>
        <Animated.View entering={rise} style={styles.head}>
          <View style={styles.piece}>
            {hero && <BarePiece item={hero} headers={headers} style={styles.pieceImage} />}
            {verdict && <Verdict verdict={verdict} />}
          </View>
          {hero && <Text style={styles.heroName}>{hero.name}</Text>}
          {verdict?.twin && hero && <Similar piece={hero} twin={verdict.twin} headers={headers} />}
          {state.addable && (
            <View style={styles.actions}>
              <Button
                kind={state.wishId ? 'outline' : 'bright'}
                label={t(state.wishId ? 'wishes.added' : 'wishes.add')}
                onPress={wish}
                disabled={state.wishId !== null}
                busy={wishing}
                style={styles.action}
              />
              <Button
                kind="outline"
                label={t(adding === 'added' ? 'wearWith.added' : 'wearWith.add')}
                onPress={addToCloset}
                disabled={adding === 'added'}
                busy={adding === 'busy'}
                style={styles.action}
              />
            </View>
          )}
          {state.outfits.length === 0 && <Text style={styles.empty}>{t('wearWith.empty')}</Text>}
        </Animated.View>
      </ThreadRow>
      {state.outfits.map((outfit, index) => (
        <ThreadRow
          key={outfit.id}
          kind="branch"
          dashed={!hers}
          last={index === state.outfits.length - 1}
          delay={(index + 1) * STAGGER_STEP}
        >
          <Animated.View style={styles.look} entering={rise.delay((index + 1) * STAGGER_STEP)}>
            <OutfitCard
              outfit={outfit}
              index={index}
              total={state.outfits.length}
              headers={headers}
              onReact={react}
              heroLoose={!hers}
            />
          </Animated.View>
        </ThreadRow>
      ))}
    </ScrollView>
  );
}

// The stylist's call beside the piece, as a note: the verdict in the display face, why by hand.
function Verdict({ verdict }: { verdict: NonNullable<WearWithRequest['verdict']> }) {
  const { t } = useTranslation();
  return (
    <View style={styles.verdict} accessibilityRole="summary">
      <Text style={styles.verdictTitle}>{t('verdict.title')}</Text>
      <Text style={styles.verdictCall}>{t(`verdict.${verdict.call}`)}</Text>
      <Text style={styles.verdictReason}>{verdict.reason}</Text>
    </View>
  );
}

// The piece she already has like this one: a short rail with just the two, the new one on a
// dashed hanger (not hers), "≈" between them. Her piece opens its own screen.
function Similar({
  piece,
  twin,
  headers,
}: {
  piece: Pick<Item, 'category' | 'photoUrl' | 'cutoutUrl'>;
  twin: Item;
  headers: Record<string, string> | undefined;
}) {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <View style={styles.similar}>
      <Text style={styles.verdictTitle}>{t('verdict.twin')}</Text>
      <View style={styles.rail}>
        <View style={styles.railLine} />
        <View
          style={styles.hung}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Hanger kind={HANGERS[piece.category]} dashed />
          <BarePiece item={piece} headers={headers} style={styles.hungImage} />
        </View>
        <Text style={styles.like} accessibilityElementsHidden importantForAccessibility="no">
          ≈
        </Text>
        <PressableScale
          style={styles.hung}
          onPress={() => router.push({ pathname: '/item/[id]', params: { id: twin.id } })}
          accessibilityRole="button"
          accessibilityLabel={`${t('verdict.twin')}: ${twin.name}`}
        >
          <Hanger kind={HANGERS[twin.category]} />
          <BarePiece item={twin} headers={headers} style={styles.hungImage} />
          <Text style={styles.hungName} numberOfLines={2}>
            {twin.name}
          </Text>
        </PressableScale>
      </View>
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingStart: 6,
    paddingEnd: 20,
    paddingTop: 12,
    paddingBottom: 48,
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
  empty: {
    fontFamily: fonts.body,
    fontSize: 15,
    lineHeight: 21,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  composing: {
    fontFamily: fonts.displayLight,
    fontSize: 24,
    lineHeight: 30,
    color: colors.text,
    textAlign: 'center',
  },
  head: {
    paddingBottom: 34,
    gap: 14,
  },
  piece: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 16,
  },
  pieceImage: {
    width: 128,
    height: 156,
  },
  heroName: {
    fontFamily: fonts.body,
    fontSize: 12,
    lineHeight: 17,
    color: colors.textMuted,
    textAlign: 'left',
  },
  verdict: {
    flex: 1,
    gap: 6,
  },
  verdictTitle: {
    fontFamily: fonts.bodyMedium,
    fontSize: 10.5,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.textMuted,
    textAlign: 'left',
  },
  verdictCall: {
    fontFamily: fonts.display,
    fontSize: 34,
    lineHeight: 38,
    color: colors.text,
    textAlign: 'left',
  },
  verdictReason: {
    fontFamily: fonts.hand,
    fontSize: 18,
    lineHeight: 24,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  similar: {
    gap: 6,
  },
  rail: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
  },
  // The rail the two hang from, across their hooks.
  railLine: {
    position: 'absolute',
    top: HANGER_PIVOT_Y,
    start: 0,
    end: 0,
    height: 1.3,
    backgroundColor: colors.text,
  },
  hung: {
    width: HANGER_WIDTH,
    alignItems: 'center',
  },
  hungImage: {
    width: 80,
    height: 96,
    marginTop: -4,
  },
  hungName: {
    marginTop: 6,
    fontFamily: fonts.body,
    fontSize: 11,
    lineHeight: 14,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  like: {
    marginTop: 54,
    fontFamily: fonts.hand,
    fontSize: 22,
    color: colors.bead,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  action: {
    minHeight: 44,
    paddingHorizontal: 18,
  },
  look: {
    paddingBottom: 32,
  },
});

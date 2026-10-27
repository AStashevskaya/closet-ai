import type { WearWithRequest } from '@closet-ai/shared';
import * as Haptics from 'expo-haptics';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ItemPhoto } from '@/components/item-photo';
import { HangerLoader } from '@/components/hanger-loader';
import { Button } from '@/components/maison';
import { PressableScale } from '@/components/pressable-scale';
import { addWish, createItem, sessionHeaders } from '@/lib/api';
import { rise, STAGGER_STEP } from '@/motion';
import { colors, fonts } from '@/theme';

import { OutfitCard } from './outfit-card';
import { useWearWith } from './use-wear-with';

// "What do I wear this with?": the outfits composed around one item, each with its reactions.
export function WearWith({ id }: { id: string }) {
  const { t } = useTranslation();
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

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {state.verdict && <Verdict verdict={state.verdict} headers={headers} />}
      {state.addable && (
        <Button
          kind={state.wishId ? 'outline' : 'ink'}
          label={t(state.wishId ? 'wishes.added' : 'wishes.add')}
          onPress={wish}
          disabled={state.wishId !== null}
          busy={wishing}
        />
      )}
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
      {state.outfits.map((outfit, index) => (
        <Animated.View
          key={outfit.id}
          style={index > 0 && styles.cardDivider}
          entering={rise.delay(index * STAGGER_STEP)}
        >
          <OutfitCard
            outfit={outfit}
            index={index}
            total={state.outfits.length}
            headers={headers}
            onReact={react}
          />
        </Animated.View>
      ))}
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
  cardDivider: {
    paddingTop: 32,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  verdict: {
    padding: 18,
    gap: 6,
    backgroundColor: colors.hero,
  },
  // A yes gets the one bright colour.
  verdictBuy: {
    backgroundColor: colors.ground,
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
});

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeOut, useReducedMotion } from 'react-native-reanimated';

import { BarePiece } from '@/components/bare-piece';
import { HandDrawn, seedFrom } from '@/components/hand-drawn';
import { Button, maison } from '@/components/maison';
import { BEAD, ThreadLine } from '@/components/thread-stops';
import { useAnnounce } from '@/lib/announce';
import { arrive, durations, STAGGER_STEP } from '@/motion';
import { OutfitCard } from '@/screens/wear-with/outfit-card';
import { useWearWith } from '@/screens/wear-with/use-wear-with';
import { colors, fonts } from '@/theme';

import { DeleteStyling, useDeleteStyling } from './delete-styling';
import { KNOT_Y, THREAD_X, ThreadRow } from './thread-row';

// The piece being styled, and the request asking for its outfits.
export type Chosen = {
  requestId: string;
  name: string;
  photoUrl?: string;
  cutoutUrl?: string;
};

type Props = {
  chosen: Chosen;
  headers: Record<string, string> | undefined;
  // Asks about the piece afresh after a failure; without it, "Try again" polls the same request.
  onAskAgain?: () => void;
  // A new request is on its way.
  asking?: boolean;
  // In Style it's diary: the thread comes from the stop above, and runs on to the stop below.
  joined?: boolean;
  continues?: boolean;
  // The styling was deleted: the stop goes.
  onDeleted: () => void;
};

// A piece's outfits growing on a thread ("The Thread", 2026-10-26): the piece on top with a knot,
// each outfit full width hanging off the thread. On the Style it tab and on its own screen for a
// closet piece opened from the item screen.
export function StyleThread({
  chosen,
  headers,
  onAskAgain,
  asking = false,
  joined = false,
  continues = false,
  onDeleted,
}: Props) {
  const { t } = useTranslation();
  const { state: looks, react, retry } = useWearWith(chosen.requestId);
  const deleting = useDeleteStyling(chosen.requestId, onDeleted);
  // A heart around the piece once one of its outfits is liked (owner's call, 2026-10-27).
  const loved = looks.status === 'done' && looks.outfits.some((o) => o.opinion === 'like');
  const reduced = useReducedMotion();
  // How tall the piece's row is, for the waiting bead's run down its thread.
  const [rowHeight, setRowHeight] = useState(0);

  const waiting = looks.status === 'pending';
  // The first read may yet come back done, so "composing" waits for the server to say so.
  const waitingFor = !waiting
    ? null
    : looks.composing
      ? t('wearWith.composing')
      : t('common.loading');
  useAnnounce(waitingFor);

  return (
    <View style={styles.thread}>
      {/* One layout while it waits and after (docs/design.md, "Waiting"): the piece and its thread
          stay, and the branches come with the looks, so nothing empty hangs there meanwhile. */}
      <View onLayout={(event) => setRowHeight(Math.round(event.nativeEvent.layout.height))}>
        {/* Keyed by the request, so a new piece draws its thread afresh. */}
        <ThreadRow key={`root-${chosen.requestId}`} kind="root" joined={joined}>
          <View style={styles.chosen}>
            <View style={styles.chosenPiece}>
              <HandDrawn
                shape="heart"
                drawn={loved}
                seed={seedFrom(chosen.requestId)}
                fill
                style={styles.chosenHeart}
              />
              <BarePiece item={chosen} headers={headers} style={styles.chosenImage} />
            </View>
            <Text style={styles.chosenTitle} accessibilityRole="header">
              {t('styleIt.open', { name: chosen.name })}
            </Text>
            {waiting && (
              <Animated.View
                exiting={FadeOut.duration(durations.state)}
                accessible
                accessibilityRole="progressbar"
                accessibilityLabel={waitingFor ?? undefined}
                accessibilityLiveRegion="polite"
              >
                {looks.composing && <Text style={maison.body}>{t('wearWith.composing')}</Text>}
              </Animated.View>
            )}
            {/* While it waits for the looks, there's nothing to delete yet. */}
            {!waiting && <DeleteStyling control={deleting} name={chosen.name} />}
          </View>
        </ThreadRow>
        {/* From the knot down the thread; mounted all along so the bead fades as it goes. No line of
            its own: the row draws that. With Reduce Motion there's no bead, just the piece. */}
        <ThreadLine
          top={-(KNOT_Y - BEAD / 2)}
          length={Math.max(0, rowHeight - KNOT_Y)}
          waiting={waiting && !reduced}
          measured={false}
          x={THREAD_X}
        />
      </View>
      {looks.status === 'failed' && (
        <ThreadRow key={`failed-${chosen.requestId}`} kind="branch" last={!continues}>
          <Animated.View style={styles.waiting} entering={arrive}>
            <Text style={maison.body}>
              {t(looks.offline ? 'common.offline' : 'wearWith.failed')}
            </Text>
            {/* A closet piece is asked about afresh; one styled before (maybe from a photo
                no longer at hand) has its request polled again. */}
            <Button
              kind="outline"
              label={t('wearWith.retry')}
              onPress={onAskAgain ?? retry}
              busy={asking}
            />
          </Animated.View>
        </ThreadRow>
      )}
      {looks.status === 'done' && looks.outfits.length === 0 && (
        <ThreadRow key={`empty-${chosen.requestId}`} kind="branch" last={!continues}>
          <Animated.Text style={[maison.body, styles.waiting]} entering={arrive}>
            {t('wearWith.empty')}
          </Animated.Text>
        </ThreadRow>
      )}
      {looks.status === 'done' &&
        looks.outfits.map((outfit, index) => (
          <ThreadRow
            key={outfit.id}
            kind="branch"
            last={!continues && index === looks.outfits.length - 1}
            loose={outfit.opinion === 'dislike'}
            delay={index * STAGGER_STEP * 3}
          >
            <Animated.View entering={arrive.delay(index * STAGGER_STEP * 3)} style={styles.outfit}>
              <OutfitCard
                outfit={outfit}
                index={index}
                total={looks.outfits.length}
                headers={headers}
                onReact={react}
              />
            </Animated.View>
          </ThreadRow>
        ))}
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  // The thread runs 20 pt in from the screen edge, as the gutter does.
  thread: {
    paddingStart: 6,
    paddingEnd: 20,
  },
  chosen: {
    paddingBottom: 28,
    gap: 14,
  },
  chosenPiece: {
    width: 200,
  },
  // Around the piece, a little wider than it and below it, so the piece sits in the heart's top.
  chosenHeart: {
    top: -14,
    bottom: -40,
    start: -26,
    end: -26,
  },
  // No grey card under the piece: it hangs in the heart.
  chosenImage: {
    width: 200,
    aspectRatio: 3 / 4,
  },
  chosenTitle: {
    marginTop: 20,
    fontFamily: fonts.displayLight,
    fontSize: 30,
    lineHeight: 34,
    color: colors.text,
    textAlign: 'left',
  },
  waiting: {
    paddingTop: 12,
    paddingBottom: 28,
    gap: 12,
    alignItems: 'flex-start',
  },
  // Level with the branch, and room before the next outfit.
  outfit: {
    paddingTop: 14,
    paddingBottom: 40,
  },
});

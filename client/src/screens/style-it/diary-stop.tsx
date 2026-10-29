import type { StyledEntry, StyledPreview } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { cutoutShadow } from '@/components/cutout-shadow';
import { HandDrawn, seedFrom } from '@/components/hand-drawn';
import { PressableScale } from '@/components/pressable-scale';
import { absoluteUrl } from '@/lib/api';
import { dayLabel } from '@/lib/day-label';
import { colors, fonts } from '@/theme';

import { ThreadRow } from './thread-row';

type Props = {
  entry: StyledEntry;
  headers: Record<string, string> | undefined;
  joined: boolean;
  last: boolean;
  onOpen: () => void;
};

// A piece styled before, on Style it's diary thread (decided 2026-10-28): the piece, when, and its
// looks folded small (a heart on the liked ones, the rejected ones left out). A tap opens it.
export function DiaryStop({ entry, headers, joined, last, onOpen }: Props) {
  const { t, i18n } = useTranslation();
  const day = dayLabel(entry.createdAt, t, i18n.language);
  return (
    <ThreadRow kind="root" joined={joined} last={last} hollow>
      <PressableScale
        style={styles.stop}
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={t('styleIt.open', { name: entry.name })}
        accessibilityHint={day}
      >
        <View style={styles.who}>
          {/* The piece on its own, no tile, with its shadow; a photo without a cut-out is framed. */}
          <View style={[styles.piece, entry.cutoutUrl ? cutoutShadow('hanging') : null]}>
            {headers && (entry.cutoutUrl ?? entry.photoUrl) && (
              <Image
                source={{ uri: absoluteUrl((entry.cutoutUrl ?? entry.photoUrl)!), headers }}
                style={styles.pieceImage}
                contentFit={entry.cutoutUrl ? 'contain' : 'cover'}
                accessibilityIgnoresInvertColors
              />
            )}
          </View>
          <View style={styles.text}>
            <Text style={styles.name} numberOfLines={2}>
              {entry.name}
            </Text>
            <Text style={styles.when}>
              {day}
              {entry.mood && ` · ${t(`wearWith.moods.${entry.mood}`)}`}
            </Text>
          </View>
        </View>
        {/* Sent with the list (the rejected ones left out), read again with it on each visit. */}
        {entry.previews.length > 0 && (
          <View
            style={styles.peek}
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            {entry.previews.map((look) => (
              <MiniLook key={look.id} look={look} headers={headers} />
            ))}
          </View>
        )}
      </PressableScale>
    </ThreadRow>
  );
}

// Where the pieces lie on a folded look's square of paper: one bigger, two beside it.
const MINI_SPOTS = [
  { start: '6%', top: '10%', width: '52%' },
  { start: '54%', top: '6%', width: '40%' },
  { start: '50%', top: '50%', width: '40%' },
] as const;

// A look folded small (as in the prototype): up to three of its pieces on white paper, without
// the piece being styled (it's right above), and a little heart on the corner once she liked it.
function MiniLook({
  look,
  headers,
}: {
  look: StyledPreview;
  headers: Record<string, string> | undefined;
}) {
  return (
    <View style={styles.mini} testID="mini-look">
      {/* Cut-outs straight on the paper, with their soft shadow; no tile of their own. */}
      {look.pieces.map((item, i) => {
        const url = item.cutoutUrl ?? item.photoUrl;
        return (
          <View key={item.id} style={[styles.miniPiece, MINI_SPOTS[i], cutoutShadow('flat')]}>
            {url && headers && (
              <Image
                source={{ uri: absoluteUrl(url), headers }}
                style={styles.miniImage}
                contentFit={item.cutoutUrl ? 'contain' : 'cover'}
                accessibilityIgnoresInvertColors
              />
            )}
          </View>
        );
      })}
      {look.liked && (
        <View style={styles.miniHeart}>
          <HandDrawn shape="heart" drawn seed={seedFrom(look.id)} fill />
        </View>
      )}
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  stop: {
    paddingBottom: 30,
    gap: 12,
  },
  who: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  piece: {
    width: 84,
    height: 96,
  },
  pieceImage: {
    flex: 1,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  name: {
    fontFamily: fonts.displayLight,
    fontSize: 24,
    lineHeight: 28,
    color: colors.text,
    textAlign: 'left',
  },
  when: {
    fontFamily: fonts.hand,
    fontSize: 18,
    lineHeight: 22,
    color: colors.text,
    textAlign: 'left',
  },
  peek: {
    flexDirection: 'row',
    gap: 8,
  },
  // A square of its own: a bare flex cell has no height on the phone (it came out 0 high).
  mini: {
    flex: 1,
    aspectRatio: 1,
    backgroundColor: colors.paper,
    ...cutoutShadow('flat'),
  },
  miniPiece: {
    position: 'absolute',
    aspectRatio: 3 / 4,
  },
  miniImage: {
    flex: 1,
  },
  // On the middle of the top edge, where a look would be pinned.
  miniHeart: {
    position: 'absolute',
    top: -11,
    start: '50%',
    marginStart: -12,
    width: 24,
    height: 22,
  },
});

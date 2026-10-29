import {
  DISLIKE_REASONS,
  type DislikeReason,
  type Outfit,
  type OutfitReaction,
} from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { seedFrom } from '@/components/hand-drawn';
import { OutfitMobile } from '@/components/outfit-mobile';
import { PartnerPiece } from '@/components/partner-piece';
import { PressableScale } from '@/components/pressable-scale';
import { colors, fonts } from '@/theme';

type Props = {
  outfit: Outfit;
  // Its place among the outfits, numbered like the pages of a lookbook.
  index: number;
  total: number;
  headers: Record<string, string> | undefined;
  onReact: (outfit: Outfit, reaction: OutfitReaction, reason?: DislikeReason) => void;
  // The piece styled isn't hers yet (one from a photo): it hangs on a dashed string.
  heroLoose?: boolean;
};

// One composed outfit: the look hanging as a mobile (a little heart on its wire once liked), the occasion, the
// stylist's idea, the pieces, partner pieces, what's missing, and the reactions.
// Shared by the outfits screen and Style it.
export function OutfitCard(props: Props) {
  return props.outfit.opinion === 'dislike' ? <Rejected {...props} /> : <Look {...props} />;
}

// "Not mine" (decided 2026-10-28): the look folds into a strip, asks why in one tap (optional,
// read by the brief), and can be brought back.
function Rejected({ outfit, index, total, onReact }: Props) {
  const { t } = useTranslation();
  const about = (label: string) => t('wearWith.reactTo', { reaction: label, n: index + 1, total });
  return (
    <View style={styles.rejected}>
      <Text style={styles.number}>
        {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')} ·{' '}
        {t('wearWith.dislike')}
      </Text>
      <Text style={styles.rejectedCaption}>{outfit.caption}</Text>
      {!outfit.reason && <Text style={styles.pieces}>{t('wearWith.why')}</Text>}
      <View style={styles.reactions} accessibilityRole="radiogroup">
        {DISLIKE_REASONS.map((reason) => (
          <Reaction
            key={reason}
            label={t(`wearWith.reasons.${reason}`)}
            a11yLabel={about(t(`wearWith.reasons.${reason}`))}
            on={outfit.reason === reason}
            radio
            onPress={() => {
              if (outfit.reason !== reason) onReact(outfit, 'dislike', reason);
            }}
          />
        ))}
      </View>
      <PressableScale
        style={styles.undo}
        onPress={() => onReact(outfit, 'none')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={about(t('wearWith.undo'))}
      >
        <Text style={styles.undoText}>{t('wearWith.undo')}</Text>
      </PressableScale>
    </View>
  );
}

function Look({ outfit, index, total, headers, onReact, heroLoose = false }: Props) {
  const { t } = useTranslation();
  const pieces = outfit.pieces.flatMap((p) => (p.item ? [p.item] : []));
  const heroId = outfit.pieces.find((p) => p.hero)?.item?.id;
  // Labelled: partner shoes or a bag where the closet had none for the look, and now and
  // then a brand's piece shown for its own sake.
  const partners = outfit.pieces.flatMap((p) => (p.catalogItem ? [p.catalogItem] : []));
  // Three looks have three "Like" buttons: a screen reader hears which look each one is for.
  const about = (reaction: string) => t('wearWith.reactTo', { reaction, n: index + 1, total });
  return (
    <View style={styles.card}>
      <Text style={styles.number}>
        {String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
      </Text>
      <OutfitMobile
        pieces={[
          ...pieces.map((p) => ({ ...p, loose: heroLoose && p.id === heroId })),
          // A partner's piece isn't hers either.
          ...partners.map((p) => ({
            ...p,
            // Apart from her pieces' ids, which come from another table.
            id: `partner-${p.id}`,
            cutoutUrl: p.imageUrl,
            loose: true,
          })),
        ]}
        headers={headers}
        caption={outfit.caption}
        loved={outfit.opinion === 'like'}
        seed={seedFrom(outfit.id)}
      />
      <Text style={styles.occasion}>{outfit.occasion}</Text>
      <Text style={styles.why}>{outfit.why}</Text>
      <Text style={styles.pieces}>{pieces.map((p) => p.name).join(' · ')}</Text>
      {partners.map((partner) => (
        <PartnerPiece key={partner.id} item={partner} headers={headers} />
      ))}
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
          a11yLabel={about(t('wearWith.like'))}
          on={outfit.opinion === 'like'}
          onPress={() => onReact(outfit, outfit.opinion === 'like' ? 'none' : 'like')}
        />
        <Reaction
          label={t('wearWith.dislike')}
          a11yLabel={about(t('wearWith.dislike'))}
          on={outfit.opinion === 'dislike'}
          onPress={() => onReact(outfit, 'dislike')}
        />
        <Reaction
          label={
            outfit.woreCount > 0
              ? t('wearWith.woreCount', { count: outfit.woreCount })
              : t('wearWith.wore')
          }
          a11yLabel={about(
            outfit.woreCount > 0
              ? t('wearWith.woreCount', { count: outfit.woreCount })
              : t('wearWith.wore'),
          )}
          on={outfit.woreCount > 0}
          onPress={() => onReact(outfit, 'wore')}
        />
      </View>
    </View>
  );
}

type ReactionProps = {
  label: string;
  a11yLabel: string;
  on: boolean;
  // One of a set (a dislike's reasons): a radio, checked rather than selected.
  radio?: boolean;
  onPress: () => void;
};

function Reaction({ label, a11yLabel, on, radio = false, onPress }: ReactionProps) {
  return (
    <PressableScale
      style={[styles.reaction, on && styles.reactionOn]}
      onPress={onPress}
      hitSlop={4}
      accessibilityRole={radio ? 'radio' : 'button'}
      accessibilityLabel={a11yLabel}
      accessibilityState={radio ? { checked: on } : { selected: on }}
    >
      <Text style={[styles.reactionText, on && styles.reactionTextOn]}>{label}</Text>
    </PressableScale>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  card: {
    gap: 8,
  },
  rejected: {
    gap: 8,
    paddingBottom: 6,
  },
  rejectedCaption: {
    fontFamily: fonts.hand,
    fontSize: 22,
    lineHeight: 28,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  undo: {
    alignSelf: 'flex-start',
    minHeight: 44,
    justifyContent: 'center',
  },
  undoText: {
    fontFamily: fonts.bodyMedium,
    fontSize: 13,
    color: colors.text,
    textDecorationLine: 'underline',
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
    borderColor: colors.bead,
    backgroundColor: colors.bead,
  },
  reactionText: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
  },
  reactionTextOn: {
    color: colors.onBead,
  },
});

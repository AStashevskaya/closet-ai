import type { CatalogItem } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { StyleSheet, Text, View } from 'react-native';

import { Dimmable } from '@/components/dimmable';
import { PressableScale } from '@/components/pressable-scale';
import { absoluteUrl } from '@/lib/api';
import { priceLabel } from '@/lib/price';
import { BRANDS_OPEN } from '@/lib/features';
import { colors, fonts } from '@/theme';

type Props = {
  item: CatalogItem;
  headers: Record<string, string> | undefined;
  // Under a look she said no to: the picture faded, the name a small step in colour. The label stays
  // as it is: a partner's piece is always labelled as one.
  dimmed?: boolean;
};

// A partner brand's piece under a look: always labelled as a partner's, and opens its card.
export function PartnerPiece({ item, headers, dimmed = false }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const label = t(item.demo ? 'partner.demoLabel' : 'partner.label');
  const price = priceLabel(item.price, item.currency);

  return (
    <PressableScale
      style={styles.row}
      onPress={() => router.push({ pathname: '/catalog/[id]', params: { id: item.id } })}
      // Brands are closed for now: the piece is shown, its card doesn't open.
      disabled={!BRANDS_OPEN}
      accessibilityRole={BRANDS_OPEN ? 'button' : undefined}
      accessibilityLabel={`${label}: ${item.brand}, ${item.name}, ${price}`}
    >
      <Dimmable dimmed={dimmed} style={styles.frame} testID="partner-picture">
        {headers && (
          <Image
            source={{ uri: absoluteUrl(item.imageUrl), headers }}
            style={styles.image}
            contentFit="contain"
            transition={200}
            accessibilityIgnoresInvertColors
          />
        )}
      </Dimmable>
      <View style={styles.text}>
        <Text style={styles.label}>{label}</Text>
        <Text style={[styles.name, dimmed && styles.nameDimmed]} numberOfLines={1}>
          {item.brand} · {item.name}
        </Text>
        <Text style={styles.price}>{price}</Text>
      </View>
      <Text style={styles.more} importantForAccessibility="no">
        ›
      </Text>
    </PressableScale>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  row: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.divider,
  },
  frame: {
    width: 48,
    aspectRatio: 3 / 4,
    padding: 4,
    backgroundColor: colors.hero,
  },
  image: {
    flex: 1,
  },
  text: {
    flex: 1,
    gap: 2,
  },
  label: {
    alignSelf: 'flex-start',
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: colors.bead,
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.onBead,
    textAlign: 'left',
  },
  name: {
    fontFamily: fonts.body,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
  },
  nameDimmed: {
    color: colors.textSecondary,
  },
  price: {
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  more: {
    fontFamily: fonts.body,
    fontSize: 22,
    color: colors.textMuted,
  },
});

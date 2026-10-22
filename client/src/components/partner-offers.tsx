import type { CatalogItem } from '@closet-ai/shared';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { PressableScale } from '@/components/pressable-scale';
import { absoluteUrl } from '@/lib/api';
import { priceLabel } from '@/lib/price';
import { colors, fonts } from '@/theme';

type Props = {
  offers: CatalogItem[];
  headers: Record<string, string> | undefined;
};

// Partner brands' pieces like an item the user doesn't own: a small labelled strip under the
// item's row, each opening its card.
export function PartnerOffers({ offers, headers }: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const label = t(offers.some((offer) => offer.demo) ? 'partner.demoLabel' : 'partner.label');

  return (
    <View style={styles.block}>
      <View style={styles.heading}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.title}>{t('partner.similar')}</Text>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {offers.map((offer) => {
          const price = priceLabel(offer.price, offer.currency);
          return (
            <PressableScale
              key={offer.id}
              style={styles.offer}
              onPress={() => router.push({ pathname: '/catalog/[id]', params: { id: offer.id } })}
              accessibilityRole="button"
              accessibilityLabel={`${label}: ${offer.brand}, ${offer.name}, ${price}`}
            >
              <View style={styles.frame}>
                {headers && (
                  <Image
                    source={{ uri: absoluteUrl(offer.imageUrl), headers }}
                    style={styles.image}
                    contentFit="contain"
                    transition={200}
                    accessibilityIgnoresInvertColors
                  />
                )}
              </View>
              <Text style={styles.name} numberOfLines={1}>
                {offer.name}
              </Text>
              <Text style={styles.price}>{price}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>
    </View>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  block: {
    paddingTop: 10,
    paddingBottom: 14,
    gap: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  heading: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  label: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    backgroundColor: colors.highlight,
    fontFamily: fonts.bodyMedium,
    fontSize: 11,
    color: colors.text,
  },
  title: {
    flexShrink: 1,
    fontFamily: fonts.body,
    fontSize: 13,
    color: colors.textSecondary,
    textAlign: 'left',
  },
  row: {
    gap: 10,
  },
  offer: {
    width: 88,
    gap: 4,
  },
  frame: {
    width: 88,
    aspectRatio: 3 / 4,
    padding: 6,
    backgroundColor: colors.hero,
  },
  image: {
    flex: 1,
  },
  name: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.text,
    textAlign: 'left',
  },
  price: {
    fontFamily: fonts.body,
    fontSize: 12,
    color: colors.textSecondary,
    textAlign: 'left',
  },
});

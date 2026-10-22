import { CURRENCIES, type Currency } from '@closet-ai/shared';
import { useTranslation } from 'react-i18next';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Chip } from '@/components/chip';
import { CURRENCY_SYMBOLS } from '@/lib/price';
import { colors, fonts } from '@/theme';

type Props = {
  brand: string;
  onBrandChange: (brand: string) => void;
  // The field's text, parsed on save (parsePrice).
  price: string;
  onPriceChange: (price: string) => void;
  currency: Currency;
  onCurrencyChange: (currency: Currency) => void;
};

// Brand and price of an item, both optional: the add-item form, each row of the several-items
// list and the item screen. A fragment, like ItemFields, so it sits in the parent's layout.
export function BrandPriceFields({
  brand,
  onBrandChange,
  price,
  onPriceChange,
  currency,
  onCurrencyChange,
}: Props) {
  const { t } = useTranslation();
  return (
    <>
      <Text style={styles.label}>
        {t('addItem.brand')} <Text style={styles.hint}>· {t('addItem.optional')}</Text>
      </Text>
      <TextInput
        style={styles.input}
        value={brand}
        onChangeText={onBrandChange}
        placeholder={t('addItem.brandPlaceholder')}
        placeholderTextColor={colors.textMuted}
        maxLength={60}
        autoCapitalize="words"
        accessibilityLabel={t('addItem.brand')}
      />

      <Text style={styles.label}>
        {t('addItem.price')} <Text style={styles.hint}>· {t('addItem.optional')}</Text>
      </Text>
      <View style={styles.priceRow}>
        <Text style={styles.symbol}>{CURRENCY_SYMBOLS[currency]}</Text>
        <TextInput
          style={[styles.input, styles.priceInput]}
          value={price}
          onChangeText={onPriceChange}
          placeholder={t('addItem.pricePlaceholder')}
          placeholderTextColor={colors.textMuted}
          keyboardType="decimal-pad"
          maxLength={10}
          accessibilityLabel={t('addItem.price')}
        />
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.currencies}
        accessibilityLabel={t('addItem.currency')}
      >
        {CURRENCIES.map((c) => (
          <Chip
            key={c}
            label={`${CURRENCY_SYMBOLS[c]} ${c}`}
            selected={currency === c}
            onPress={() => onCurrencyChange(c)}
          />
        ))}
      </ScrollView>
    </>
  );
}

// textAlign has no start/end in React Native: 'left' follows the layout direction, so it acts as start in RTL.
const styles = StyleSheet.create({
  label: {
    marginTop: 12,
    fontFamily: fonts.bodySemiBold,
    fontSize: 14,
    color: colors.text,
    textAlign: 'left',
  },
  hint: {
    fontFamily: fonts.body,
    color: colors.textMuted,
  },
  // Underlined, as on a brand's checkout, instead of boxed.
  input: {
    height: 48,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.textMuted,
    fontFamily: fonts.body,
    fontSize: 15,
    color: colors.text,
    textAlign: 'left',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  symbol: {
    fontFamily: fonts.display,
    fontSize: 22,
    color: colors.text,
  },
  priceInput: {
    flex: 1,
  },
  currencies: {
    gap: 8,
    paddingVertical: 4,
  },
});

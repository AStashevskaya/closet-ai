import { CURRENCIES, type Currency } from '@closet-ai/shared';
import { getLocales } from 'expo-localization';

export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  ILS: '₪',
  USD: '$',
  EUR: '€',
  GBP: '£',
  RUB: '₽',
  UAH: '₴',
  BYN: 'Br',
};

// The phone's own currency when we know it, else the shekel (the first market).
// Later the profile's country decides.
export function defaultCurrency(): Currency {
  const code = getLocales()[0]?.currencyCode;
  return CURRENCIES.find((c) => c === code) ?? 'ILS';
}

// The price field's text as a number: null when empty, undefined when it isn't a price.
// Russian and Hebrew keyboards type a comma for the decimal point.
export function parsePrice(text: string): number | null | undefined {
  const trimmed = text.trim().replace(',', '.');
  if (trimmed === '') return null;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(trimmed)) return undefined;
  return Number(trimmed);
}

export const priceText = (price: number | null | undefined) => (price == null ? '' : String(price));

import { parsePrice, priceText } from './price';

test('reads a price typed with a dot or a comma', () => {
  expect(parsePrice('349.90')).toBe(349.9);
  expect(parsePrice(' 349,9 ')).toBe(349.9);
  expect(parsePrice('120')).toBe(120);
});

test('an empty field is no price, and anything else is not a price', () => {
  expect(parsePrice('')).toBeNull();
  for (const text of ['abc', '1.234', '-5', '12 000', '1e3'])
    expect(parsePrice(text)).toBeUndefined();
});

test('shows a stored price back in the field', () => {
  expect(priceText(349.9)).toBe('349.9');
  expect(priceText(null)).toBe('');
});

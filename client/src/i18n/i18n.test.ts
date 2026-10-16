import i18n, { resources } from '.';

// Every key path in a nested translation object, with plural suffixes stripped.
function keys(obj: object, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([key, value]) =>
    typeof value === 'object'
      ? keys(value, `${prefix}${key}.`)
      : [`${prefix}${key.replace(/_(zero|one|two|few|many|other)$/, '')}`],
  );
}

describe('translations', () => {
  test('Hebrew and Russian have the same keys', () => {
    const he = new Set(keys(resources.he.translation));
    const ru = new Set(keys(resources.ru.translation));

    expect([...he].sort()).toEqual([...ru].sort());
  });

  test.each([
    [1, '1 вещь'],
    [3, '3 вещи'],
    [5, '5 вещей'],
    [21, '21 вещь'],
  ])('Russian plural for %i', (count, expected) => {
    expect(i18n.t('items.count', { count, lng: 'ru' })).toBe(expected);
  });

  test.each([
    [1, 'פריט אחד'],
    [2, 'שני פריטים'],
    [5, '5 פריטים'],
  ])('Hebrew plural for %i', (count, expected) => {
    expect(i18n.t('items.count', { count, lng: 'he' })).toBe(expected);
  });
});

import { Platform } from 'react-native';

import { colors } from '@/theme';

import { cutoutShadow } from './cutout-shadow';

const setOS = (os: typeof Platform.OS) => Object.defineProperty(Platform, 'OS', { value: os });
const original = Platform.OS;
afterEach(() => setOS(original));

describe('cutoutShadow', () => {
  test('on iOS, a layer shadow in the thread colour', () => {
    setOS('ios');
    expect(cutoutShadow('hanging')).toMatchObject({
      shadowColor: colors.text,
      shadowOpacity: 0.22,
      shadowOffset: { width: 0, height: 8 },
    });
  });

  test('on Android, a drop-shadow filter with the alpha on the thread colour', () => {
    setOS('android');
    expect(cutoutShadow('flat')).toEqual({
      filter: [
        { dropShadow: { offsetX: 0, offsetY: 5, standardDeviation: 3, color: `${colors.text}29` } },
      ],
    });
  });

  test('the thread colour stays a 6-digit hex, which the Android colour builds on', () => {
    expect(colors.text).toMatch(/^#[0-9A-Fa-f]{6}$/);
  });
});

import { render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { Closet } from '.';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

describe('<Closet />', () => {
  test('renders the title and categories in English', async () => {
    await i18n.changeLanguage('en');
    await render(<Closet />);

    expect(screen.getByText('My wardrobe')).toBeOnTheScreen();
    expect(screen.getByText('Outerwear')).toBeOnTheScreen();
  });

  test('renders the title and categories in Russian', async () => {
    await i18n.changeLanguage('ru');
    await render(<Closet />);

    expect(screen.getByText('Мой гардероб')).toBeOnTheScreen();
    expect(screen.getByText('Верхняя одежда')).toBeOnTheScreen();
  });

  test('renders the title in Hebrew', async () => {
    await i18n.changeLanguage('he');
    await render(<Closet />);

    expect(screen.getByText('הארון שלי')).toBeOnTheScreen();
  });
});

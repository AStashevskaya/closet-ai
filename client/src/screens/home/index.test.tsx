import { render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { Home } from '.';

describe('<Home />', () => {
  test('renders the title and categories in Russian', async () => {
    await i18n.changeLanguage('ru');
    await render(<Home />);

    expect(screen.getByText('Мой гардероб')).toBeOnTheScreen();
    expect(screen.getByText('Верхняя одежда')).toBeOnTheScreen();
  });

  test('renders the title in Hebrew', async () => {
    await i18n.changeLanguage('he');
    await render(<Home />);

    expect(screen.getByText('הארון שלי')).toBeOnTheScreen();
  });
});

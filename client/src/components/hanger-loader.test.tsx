import { render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { HangerLoader } from './hanger-loader';

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

test('tells screen readers that something is loading', async () => {
  await render(<HangerLoader size="small" />);
  expect(screen.getByRole('progressbar', { name: 'Loading' })).toBeOnTheScreen();
});

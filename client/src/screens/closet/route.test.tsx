import { render, screen } from '@testing-library/react-native';

import ClosetCategoryRoute from '@/app/closet/[category]';

// `mock` prefix: jest.mock factories may only use variables named like this.
let mockCategory = 'bottom';

jest.mock('expo-router', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    useLocalSearchParams: () => ({ category: mockCategory }),
    Redirect: ({ href }: { href: string }) => <MockText>{`redirect ${href}`}</MockText>,
  };
});
jest.mock('./category', () => {
  const { Text: MockText } = jest.requireActual('react-native');
  return {
    ClosetCategory: ({ category }: { category: string }) => (
      <MockText>{`category ${category}`}</MockText>
    ),
  };
});

// The route lives in src/app, where every file becomes a screen, so its test sits here.
describe('closet/[category] route', () => {
  test('opens a known category', async () => {
    mockCategory = 'bottom';
    await render(<ClosetCategoryRoute />);
    expect(screen.getByText('category bottom')).toBeOnTheScreen();
  });

  test('sends an unknown one back to the closet', async () => {
    mockCategory = 'hats';
    await render(<ClosetCategoryRoute />);
    expect(screen.getByText('redirect /')).toBeOnTheScreen();
  });
});

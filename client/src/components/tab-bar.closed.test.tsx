import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { TabBar } from './tab-bar';

// Brands closed, as they ship now (owner, 2026-11-11).
const mockPush = jest.fn();
jest.mock('@/lib/features', () => ({ BRANDS_OPEN: false }));
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => ({ Tabs: () => null, useRouter: () => ({ push: mockPush }) }));

const routes = ['index', 'style', 'the-edit', 'profile'].map((name) => ({
  key: `${name}-key`,
  name,
}));
const titles: Record<string, string> = {
  index: 'Closet',
  style: 'Style it',
  'the-edit': 'Brands',
  profile: 'Profile',
};

function setup(index = 0) {
  const emitter = { emit: jest.fn(() => ({ defaultPrevented: false })) };
  const navigateToTab = jest.fn();
  const descriptors = Object.fromEntries(
    routes.map((r) => [r.key, { options: { title: titles[r.name] } }]),
  );
  const props = {
    state: { index, routes },
    descriptors,
    emitter,
    navigateToTab,
  } as unknown as Parameters<typeof TabBar>[0];
  return { navigateToTab, props };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

describe('<TabBar /> with brands closed', () => {
  test('keeps Brands in the bar, faint and saying "soon", and does nothing on a tap', async () => {
    await i18n.changeLanguage('en');
    const { props, navigateToTab } = setup(0);
    await render(<TabBar {...props} />);
    const brands = screen.getByRole('tab', { name: 'Brands, soon' });
    expect(brands).toBeDisabled();
    await fireEvent.press(brands);
    expect(navigateToTab).not.toHaveBeenCalled();
  });
});

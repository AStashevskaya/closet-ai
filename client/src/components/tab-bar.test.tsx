import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { TabBar } from './tab-bar';

// `mock` prefix: jest.mock factories may only use variables named like this.
const mockPush = jest.fn();

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);
jest.mock('expo-router', () => ({ Tabs: () => null, useRouter: () => ({ push: mockPush }) }));

const routes = ['index', 'style', 'inspiration', 'profile'].map((name) => ({
  key: `${name}-key`,
  name,
}));
const titles: Record<string, string> = {
  index: 'Closet',
  style: 'Style it',
  inspiration: 'Inspiration',
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

describe('<TabBar />', () => {
  test('shows the tabs by their titles to screen readers, the current one selected', async () => {
    const { props } = setup(1);
    await render(<TabBar {...props} />);
    expect(screen.getByRole('tab', { name: 'Style it', selected: true })).toBeOnTheScreen();
    expect(screen.getByRole('tab', { name: 'Closet', selected: false })).toBeOnTheScreen();
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  test('writes every tab as a word on the thread', async () => {
    const { props } = setup(0);
    await render(<TabBar {...props} />);
    for (const title of Object.values(titles)) expect(screen.getByText(title)).toBeOnTheScreen();
  });

  test('goes to another tab, and opens the add-item form from the middle', async () => {
    const { props, navigateToTab } = setup(0);
    await render(<TabBar {...props} />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Inspiration' }));
    expect(navigateToTab).toHaveBeenCalledWith('inspiration-key');

    await fireEvent.press(screen.getByRole('button', { name: 'Add item' }));
    expect(mockPush).toHaveBeenCalledWith('/add-item');
  });
});

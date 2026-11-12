import type { FoundPiece, Item } from '@closet-ai/shared';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import i18n from '@/i18n';
import { wearFound } from '@/lib/api';
import { ApiError } from '@/lib/api-error';
import { rememberMorning } from '@/lib/morning';

import { FoundLine, FoundSheet } from './found';

jest.mock('expo-router', () => ({ useFocusEffect: jest.fn() }));
jest.mock('@/lib/api', () => ({
  getFound: jest.fn(),
  wearFound: jest.fn(),
  absoluteUrl: (path: string) => `http://api.test${path}`,
}));
jest.mock('@/lib/morning', () => ({ rememberMorning: jest.fn().mockResolvedValue(undefined) }));

const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});

const item = (n: number, name: string, category: Item['category']): Item => ({
  id: `6b1f7c3e-0000-4000-8000-00000000000${n}`,
  name,
  category,
  colors: ['red'],
  seasons: [],
  photoUrl: `/api/items/${n}/photo`,
  createdAt: '2026-10-01T10:00:00.000Z',
});
const cardigan = item(1, 'Red cardigan', 'top');
const skirt = item(2, 'Black skirt', 'bottom');
const jeans = item(3, 'Jeans', 'bottom');
const loafers = item(4, 'Loafers', 'shoes');
const found: FoundPiece = {
  piece: cardigan,
  looks: [{ pieces: [cardigan, skirt, loafers] }, { pieces: [cardigan, jeans, loafers] }],
  week: '2026-11-09',
};

beforeEach(async () => {
  jest.clearAllMocks();
  await i18n.changeLanguage('en');
});

test('the line under the find leads on to what to wear it with', async () => {
  const open = jest.fn();
  await render(<FoundLine onOpen={open} />);
  expect(screen.getByText('look what turned up')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'What to wear it with' }));
  expect(open).toHaveBeenCalled();
});

describe('<FoundSheet />', () => {
  test('"I\'ll wear it" makes that look tomorrow\'s and brings the piece up tomorrow morning', async () => {
    jest.mocked(wearFound).mockResolvedValue({ date: '2026-11-13' });
    await render(<FoundSheet found={found} headers={undefined} visible onClose={() => {}} />);

    expect(screen.getByRole('header', { name: 'a new life for this piece' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Look 2: Red cardigan, Jeans, Loafers')).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole('button', { name: 'Wear look 2 tomorrow' }));

    expect(wearFound).toHaveBeenCalledWith('en', [cardigan.id, jeans.id, loafers.id]);
    expect(await screen.findByText('wearing it tomorrow ✓')).toBeOnTheScreen();
    expect(rememberMorning).toHaveBeenCalledWith('2026-11-13', 'Red cardigan');
    // One look for tomorrow: the other can't be chosen now.
    expect(screen.getByRole('button', { name: 'Wear look 1 tomorrow' })).toBeDisabled();
  });

  test('says so when tomorrow already has its look', async () => {
    jest.mocked(wearFound).mockRejectedValue(new ApiError(409, 'Tomorrow already has a look'));
    await render(<FoundSheet found={found} headers={undefined} visible onClose={() => {}} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Wear look 1 tomorrow' }));
    expect(alert).toHaveBeenCalledWith('Tomorrow already has its look.');
    expect(rememberMorning).not.toHaveBeenCalled();
    expect(screen.queryByText('wearing it tomorrow ✓')).not.toBeOnTheScreen();
  });
});

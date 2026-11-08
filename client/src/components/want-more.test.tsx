import { fireEvent, render, screen } from '@testing-library/react-native';

import { wantMore } from '@/lib/api';

import { WantMore } from './want-more';

jest.mock('@/lib/api', () => ({ wantMore: jest.fn() }));

describe('<WantMore />', () => {
  beforeEach(() => jest.mocked(wantMore).mockReset().mockResolvedValue());

  test('tells the server once and says thanks', async () => {
    await render(<WantMore code="wear_with" />);
    await fireEvent.press(screen.getByText('I want more'));

    expect(wantMore).toHaveBeenCalledTimes(1);
    expect(wantMore).toHaveBeenCalledWith('wear_with');
    expect(screen.getByText('Thanks, noted!')).toBeOnTheScreen();
    expect(screen.queryByText('I want more')).toBeNull();
  });

  test('offers again when a different limit is reached on the same screen', async () => {
    const { rerender } = await render(<WantMore code="want" />);
    await fireEvent.press(screen.getByText('I want more'));
    await rerender(<WantMore code="monthly" />);
    await fireEvent.press(screen.getByText('I want more'));

    expect(wantMore).toHaveBeenLastCalledWith('monthly');
    expect(wantMore).toHaveBeenCalledTimes(2);
  });

  test('still says thanks when the request fails', async () => {
    jest.mocked(wantMore).mockRejectedValue(new Error('offline'));
    await render(<WantMore code="want" />);
    await fireEvent.press(screen.getByText('I want more'));

    expect(screen.getByText('Thanks, noted!')).toBeOnTheScreen();
  });

  test.each(['budget', 'item_photo', 'inspiration'] as const)(
    "isn't offered on %s, which no plan would lift",
    async (code) => {
      await render(<WantMore code={code} />);
      expect(screen.queryByText('I want more')).toBeNull();
    },
  );
});

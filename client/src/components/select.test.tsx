import { fireEvent, render, screen } from '@testing-library/react-native';

import { Select } from './select';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

const options = [
  { value: 'ru', label: 'Русский' },
  { value: 'en', label: 'English' },
];

describe('Select', () => {
  test('shows the current choice and opens the options with it checked', async () => {
    await render(<Select label="Language" value="ru" options={options} onChange={jest.fn()} />);
    expect(screen.queryByRole('radio')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Language: Русский' }));
    expect(screen.getByRole('radio', { name: 'Русский', checked: true })).toBeOnTheScreen();
    expect(screen.getByRole('radio', { name: 'English', checked: false })).toBeOnTheScreen();
  });

  test('a pick closes the sheet and reports only a change', async () => {
    const onChange = jest.fn();
    await render(<Select label="Language" value="ru" options={options} onChange={onChange} />);

    await fireEvent.press(screen.getByRole('button', { name: 'Language: Русский' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'Русский' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('radio')).toBeNull();

    await fireEvent.press(screen.getByRole('button', { name: 'Language: Русский' }));
    await fireEvent.press(screen.getByRole('radio', { name: 'English' }));
    expect(onChange).toHaveBeenCalledWith('en');
    expect(screen.queryByRole('radio')).toBeNull();
  });

  test('closes without a pick from outside the sheet', async () => {
    const onChange = jest.fn();
    await render(<Select label="Language" value="ru" options={options} onChange={onChange} />);
    await fireEvent.press(screen.getByRole('button', { name: 'Language: Русский' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('radio')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  test("doesn't open while disabled", async () => {
    await render(
      <Select label="Language" value="ru" options={options} onChange={jest.fn()} disabled />,
    );
    await fireEvent.press(screen.getByRole('button', { name: 'Language: Русский' }));
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

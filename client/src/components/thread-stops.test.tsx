import { render, renderHook, screen } from '@testing-library/react-native';
import { Text, View } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { colors } from '@/theme';

import { ThreadLine, ThreadStop, useThreadMotion } from './thread-stops';

// The line and its beads are decoration, hidden from screen readers.
const hidden = { includeHiddenElements: true };

afterEach(() => jest.restoreAllMocks());

describe('ThreadLine', () => {
  test('runs a bead only while something is waited for', async () => {
    await render(<ThreadLine top={20} length={300} waiting />);
    expect(screen.getByTestId('thread-waiting', hidden)).toBeOnTheScreen();

    await screen.rerender(<ThreadLine top={20} length={300} waiting={false} />);
    expect(screen.queryByTestId('thread-waiting', hidden)).not.toBeOnTheScreen();
  });

  test('draws the line once it has a length', async () => {
    await render(<ThreadLine top={20} length={0} waiting={false} />);
    expect(screen.queryByTestId('thread-line', hidden)).not.toBeOnTheScreen();

    await screen.rerender(<ThreadLine top={20} length={300} waiting={false} />);
    expect(screen.getByTestId('thread-line', hidden)).toBeOnTheScreen();
  });

  test('can run its bead before the line is measured', async () => {
    await render(<ThreadLine top={26} length={26} measured={false} waiting />);
    expect(screen.queryByTestId('thread-line', hidden)).not.toBeOnTheScreen();
    expect(screen.getByTestId('thread-waiting', hidden)).toBeOnTheScreen();
  });

  test('is drawn at the weight it is given', async () => {
    await render(<ThreadLine top={0} length={100} waiting={false} weight={1.4} />);
    expect(screen.getByTestId('thread-line', hidden)).toHaveStyle({ width: 1.4, start: 4.3 });
  });
});

describe('ThreadStop', () => {
  test('marks a stop with a bead, an empty dot or a dashed one', async () => {
    await render(
      <View>
        <ThreadStop kind="bead" dotY={10}>
          <Text>Name</Text>
        </ThreadStop>
        <ThreadStop kind="empty" dotY={10}>
          <Text>Colours</Text>
        </ThreadStop>
        <ThreadStop kind="optional" dotY={10}>
          <Text>Brand</Text>
        </ThreadStop>
      </View>,
    );
    const [bead, empty, optional] = screen.getAllByTestId('thread-dot', hidden);
    expect(bead).toHaveStyle({ top: 10, backgroundColor: colors.bead });
    expect(empty).toHaveStyle({ backgroundColor: colors.background, borderColor: colors.text });
    expect(optional).toHaveStyle({ borderStyle: 'dashed', borderColor: colors.textMuted });
    expect(screen.getByText('Name')).toBeOnTheScreen();
  });

  test('takes a marker in place of its dot', async () => {
    await render(
      <ThreadStop marker={<View testID="hanger" />}>
        <Text>Hanging it on</Text>
      </ThreadStop>,
    );
    expect(screen.getByTestId('hanger')).toBeOnTheScreen();
    expect(screen.queryByTestId('thread-dot', hidden)).not.toBeOnTheScreen();
  });
});

describe('useThreadMotion', () => {
  test('waits to be measured before drawing in', async () => {
    const { result, rerender } = await renderHook(
      ({ measured }: { measured: boolean }) => useThreadMotion(measured, false),
      { initialProps: { measured: false } },
    );
    expect(result.current.drawn.get()).toBe(0);
    await rerender({ measured: true });
    expect(result.current.drawn.get()).toBe(1);
  });

  test('with Reduce Motion the thread is simply there and the bead stays still', async () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    const { result } = await renderHook(() => useThreadMotion(false, true));
    expect(result.current.drawn.get()).toBe(1);
    expect(result.current.run.get()).toBe(0);
  });
});

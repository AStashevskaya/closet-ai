import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { LaunchCurtain } from './launch-curtain';

describe('<LaunchCurtain />', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('is decoration over the app, and says when its copy of the launch screen is drawn', async () => {
    const shown = jest.fn();
    await render(<LaunchCurtain ready={false} onShown={shown} />);
    const curtain = screen.getByTestId('launch-curtain', { includeHiddenElements: true });
    expect(curtain.props.pointerEvents).toBe('none');
    expect(curtain.props.accessibilityElementsHidden).toBe(true);

    await fireEvent(screen.getByTestId('launch-picture', { includeHiddenElements: true }), 'load');
    // Two frames later, once the copy is surely on screen.
    expect(shown).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(100);
    });
    expect(shown).toHaveBeenCalled();
  });

  test('a slow start shows the bead running on a rail under the hanger', async () => {
    await render(<LaunchCurtain ready={false} onShown={() => {}} />);
    expect(screen.queryAllByTestId('thread-waiting', { includeHiddenElements: true })).toHaveLength(
      0,
    );

    await act(async () => {
      jest.advanceTimersByTime(1000);
    });
    expect(
      screen.getAllByTestId('thread-waiting', { includeHiddenElements: true }).length,
    ).toBeGreaterThan(0);
  });
});

describe('<LaunchCurtain /> once the app is ready', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('goes, and ends the launch, even with no rail to land on', async () => {
    const { isLaunching } = jest.requireActual<typeof import('@/lib/launch')>('@/lib/launch');
    const view = await render(<LaunchCurtain ready={false} onShown={() => {}} />);
    await view.rerender(<LaunchCurtain ready onShown={() => {}} />);

    // Step by step: each stage's timer is set once the one before has re-rendered.
    for (let step = 0; step < 6; step++) {
      await act(async () => {
        jest.advanceTimersByTime(500);
      });
    }
    expect(
      screen.queryByTestId('launch-curtain', { includeHiddenElements: true }),
    ).not.toBeOnTheScreen();
    expect(isLaunching()).toBe(false);
  });
});

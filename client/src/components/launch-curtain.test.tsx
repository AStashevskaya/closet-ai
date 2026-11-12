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

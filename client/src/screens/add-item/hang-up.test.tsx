import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { flightFrom, HangUp } from './hang-up';

const overlay = { x: 0, y: 100, width: 390, height: 700 };

describe('<HangUp />', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function hangUp(onDone: () => void) {
    return render(
      <HangUp
        photoUri="file:///small.jpg"
        from={null}
        category="top"
        caption="On the Tops rail"
        onDone={onDone}
      />,
    );
  }

  test('closes once, whether tapped or timed out', async () => {
    const onDone = jest.fn();
    await hangUp(onDone);
    await fireEvent.press(screen.getByText('On the Tops rail'));
    await act(() => jest.advanceTimersByTimeAsync(5000));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('closes on its own after the swing', async () => {
    const onDone = jest.fn();
    await hangUp(onDone);
    await act(() => jest.advanceTimersByTimeAsync(3000));
    expect(onDone).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTimeAsync(500));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('does nothing once the sheet is gone', async () => {
    const onDone = jest.fn();
    await hangUp(onDone);
    await screen.unmount();
    await act(() => jest.advanceTimersByTimeAsync(5000));
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('flightFrom', () => {
  test('hangs the piece on a rail across the middle of the screen', () => {
    const { railY, top } = flightFrom(null, overlay);
    expect(railY).toBe(280);
    // The hook sits on the rail.
    expect(top).toBeLessThan(railY);
  });

  test('starts from where the photo is in the print, at its size', () => {
    // The photo hanging where it ends: no move at all.
    const still = flightFrom(null, overlay);
    const atRest = flightFrom(
      { x: 140, y: 100 + still.top + 28, width: 110, height: 127 },
      overlay,
    );
    expect(atRest.scale).toBe(1);
    expect(atRest.x).toBeCloseTo(0);
    expect(atRest.y).toBeCloseTo(0);

    // A photo twice as wide, further up: scaled up and moved there.
    const print = flightFrom({ x: 20, y: 150, width: 220, height: 254 }, overlay);
    expect(print.scale).toBe(2);
    expect(print.y).toBeLessThan(0);
  });

  test('flies from the rail itself when the print could not be measured', () => {
    expect(flightFrom(null, overlay)).toMatchObject({ x: 0, y: 0, scale: 1 });
  });
});

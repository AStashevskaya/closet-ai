import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { flightFrom, HangUp } from './hang-up';

const overlay = { x: 0, y: 100, width: 390, height: 700 };

describe('<HangUp />', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function hangUp(onDone: () => void) {
    return render(
      <HangUp
        pieces={[{ key: 'one', photo: null, from: null, category: 'top' }]}
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

  test('hangs a batch side by side, smaller when they would not fit', () => {
    const pieces = [0, 1, 2].map((index) => flightFrom(null, overlay, index, 3));
    // Left to right in reading order, around the middle.
    expect(pieces[0]!.rest.x).toBeLessThan(0);
    expect(pieces[1]!.rest.x).toBeCloseTo(0);
    expect(pieces[2]!.rest.x).toBeCloseTo(-pieces[0]!.rest.x);
    // Two fit at full size; eight don't.
    expect(flightFrom(null, overlay, 0, 2).rest.scale).toBe(1);
    const many = flightFrom(null, overlay, 0, 8);
    expect(many.rest.scale).toBeLessThan(1);
    expect(many.bottom).toBeLessThan(pieces[0]!.bottom);
  });
});

describe('<HangUp /> with a batch', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('waits for the last piece before it closes', async () => {
    const onDone = jest.fn();
    await render(
      <HangUp
        pieces={['a', 'b', 'c'].map((key) => ({ key, photo: null, from: null, category: 'top' }))}
        caption="3 pieces in your closet"
        onDone={onDone}
      />,
    );
    await act(() => jest.advanceTimersByTimeAsync(3300));
    expect(onDone).not.toHaveBeenCalled();
    await act(() => jest.advanceTimersByTimeAsync(300));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});

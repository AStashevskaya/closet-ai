import { leanFor, stepPendulum, type Pendulum } from './swing';

describe('leanFor', () => {
  test('hangs straight while the rail keeps the speed the pieces are used to', () => {
    expect(leanFor(0, false)).toBeCloseTo(0);
  });

  test('leans against a change of speed, more the bigger the change', () => {
    // Speeding up towards the start (left in English), the pieces trail to the right: a negative turn.
    expect(leanFor(0.5, false)).toBeLessThan(0);
    expect(leanFor(1, false)).toBeLessThan(leanFor(0.5, false));
  });

  test('mirrors in right-to-left layouts', () => {
    expect(leanFor(0.5, true)).toBeCloseTo(-leanFor(0.5, false));
  });

  test('never leans past the limit, however hard the fling', () => {
    expect(leanFor(50, false)).toBe(-28);
    expect(leanFor(-50, false)).toBe(28);
  });
});

describe('stepPendulum', () => {
  // A second of a piece pulled towards `lean`, at 60 frames a second; its angle every frame.
  function swingFor(seconds: number, lean: number) {
    let piece: Pendulum = { angle: 0, spin: 0 };
    const angles: number[] = [];
    for (let i = 0; i < seconds * 60; i++) {
      piece = stepPendulum(piece, lean, 80, 1 / 60);
      angles.push(piece.angle);
    }
    return { piece, angles };
  }

  test('swings past the lean before it settles, like a hanger', () => {
    const { angles } = swingFor(2, 10);
    expect(Math.max(...angles)).toBeGreaterThan(10);
  });

  test('comes to rest at the lean in the end', () => {
    const { piece } = swingFor(20, 10);
    expect(piece.angle).toBeCloseTo(10, 1);
    expect(piece.spin).toBeCloseTo(0, 1);
  });

  test('stays at rest with nothing pulling it', () => {
    const { piece } = swingFor(1, 0);
    expect(piece).toEqual({ angle: 0, spin: 0 });
  });
});

import { render, screen } from '@testing-library/react-native';

import { AuthRail, silhouetteOpacity } from './auth-rail';

describe('<AuthRail />', () => {
  test('hangs five pieces, hidden from screen readers', async () => {
    await render(<AuthRail filled />);

    expect(screen.queryAllByTestId('auth-rail-piece')).toHaveLength(0);
    expect(screen.getAllByTestId('auth-rail-piece', { includeHiddenElements: true })).toHaveLength(
      5,
    );
  });

  test('empties and fills again without remounting', async () => {
    await render(<AuthRail filled={false} />);
    const before = screen.getAllByTestId('auth-rail-piece', { includeHiddenElements: true });

    await screen.rerender(<AuthRail filled />);

    const after = screen.getAllByTestId('auth-rail-piece', { includeHiddenElements: true });
    expect(after).toHaveLength(5);
    expect(after[0]).toBe(before[0]);
  });

  test('an empty hanger shows nothing; a filled one a faint piece', () => {
    expect(silhouetteOpacity(0)).toBe(0);
    expect(silhouetteOpacity(1)).toBeGreaterThan(0);
    expect(silhouetteOpacity(1)).toBeLessThan(0.5);
  });
});

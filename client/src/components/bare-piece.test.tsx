import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { BarePiece } from './bare-piece';

jest.mock('@/lib/api', () => ({ absoluteUrl: (path: string) => `http://api.test${path}` }));

const headers = { cookie: 'session=1' };
const photoUrl = '/api/items/1/photo';
const cutoutUrl = '/api/items/1/photo?variant=cutout';

describe('BarePiece', () => {
  test('fills the frame with the photo while there is no cut-out, without a shadow', async () => {
    await render(<BarePiece item={{ photoUrl }} headers={headers} style={{}} />);
    // expo-image hands its native view the source as a list.
    const image = screen.getByTestId('bare-piece');
    expect(image.props.source).toEqual([{ uri: `http://api.test${photoUrl}`, headers }]);
    expect(image.props.contentFit).toBe('cover');
    expect(StyleSheet.flatten(image.parent?.props.style)).not.toHaveProperty('shadowOpacity');
  });

  test('shows the whole cut-out with its shadow, on no background', async () => {
    await render(<BarePiece item={{ photoUrl, cutoutUrl }} headers={headers} style={{}} />);
    const image = screen.getByTestId('bare-piece');
    expect(image.props.source).toEqual([{ uri: `http://api.test${cutoutUrl}`, headers }]);
    expect(image.props.contentFit).toBe('contain');
    const wrapper = StyleSheet.flatten(image.parent?.props.style);
    expect(wrapper).toHaveProperty('shadowOpacity');
    expect(wrapper).not.toHaveProperty('backgroundColor');
  });

  test('keeps the same image when the cut-out arrives, so the two crossfade', async () => {
    const view = await render(<BarePiece item={{ photoUrl }} headers={headers} style={{}} />);
    const before = screen.getByTestId('bare-piece');
    await view.rerender(<BarePiece item={{ photoUrl, cutoutUrl }} headers={headers} style={{}} />);
    expect(screen.getByTestId('bare-piece')).toBe(before);
  });

  test('draws nothing while the photo is processing', async () => {
    await render(<BarePiece item={{}} headers={headers} style={{}} />);
    expect(screen.queryByTestId('bare-piece')).not.toBeOnTheScreen();
  });
});

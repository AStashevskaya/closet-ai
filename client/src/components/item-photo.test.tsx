import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { ItemPhoto } from './item-photo';

jest.mock('@/lib/api', () => ({ absoluteUrl: (path: string) => `http://api.test${path}` }));

const headers = { cookie: 'session=1' };
const photoUrl = '/api/items/1/photo';
const cutoutUrl = '/api/items/1/photo?variant=cutout';

describe('ItemPhoto', () => {
  test('fills the frame with the photo while there is no cut-out', async () => {
    await render(<ItemPhoto item={{ photoUrl }} headers={headers} style={{}} />);
    // expo-image hands its native view the source as a list.
    const image = screen.getByTestId('item-photo');
    expect(image.props.source).toEqual([{ uri: `http://api.test${photoUrl}`, headers }]);
    expect(image.props.contentFit).toBe('cover');
  });

  test('shows the whole cut-out once there is one', async () => {
    await render(<ItemPhoto item={{ photoUrl, cutoutUrl }} headers={headers} style={{}} />);
    // expo-image hands its native view the source as a list.
    const image = screen.getByTestId('item-photo');
    expect(image.props.source).toEqual([{ uri: `http://api.test${cutoutUrl}`, headers }]);
    expect(image.props.contentFit).toBe('contain');
  });

  test('keeps the same image when the cut-out arrives, so the two crossfade', async () => {
    const view = await render(<ItemPhoto item={{ photoUrl }} headers={headers} style={{}} />);
    const before = screen.getByTestId('item-photo');
    await view.rerender(<ItemPhoto item={{ photoUrl, cutoutUrl }} headers={headers} style={{}} />);
    const after = screen.getByTestId('item-photo');
    // Same element instance: React updated its source instead of mounting a new image.
    expect(after).toBe(before);
    expect(after.props.contentFit).toBe('contain');
  });

  test('gives only a cut-out a shadow, on a wrapper without a background', async () => {
    const view = await render(<ItemPhoto item={{ photoUrl }} headers={headers} style={{}} />);
    const wrapper = () => StyleSheet.flatten(screen.getByTestId('item-photo').parent?.props.style);
    expect(wrapper()).not.toHaveProperty('shadowOpacity');
    await view.rerender(<ItemPhoto item={{ photoUrl, cutoutUrl }} headers={headers} style={{}} />);
    expect(wrapper()).toHaveProperty('shadowOpacity');
    expect(wrapper()).not.toHaveProperty('backgroundColor');
  });

  test('shows only the frame while the photo is processing', async () => {
    await render(<ItemPhoto item={{}} headers={headers} style={{}} />);
    expect(screen.queryByTestId('item-photo')).not.toBeOnTheScreen();
  });
});

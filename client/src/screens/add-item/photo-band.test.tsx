import { render, screen } from '@testing-library/react-native';
import * as Reanimated from 'react-native-reanimated';

import { cutoutFrame } from './cutout-frame';
import { CutoutImage } from './photo-band';

const cutout = {
  uri: 'http://api/c',
  headers: {},
  box: { xMin: 0.2, yMin: 0.25, xMax: 0.6, yMax: 0.75 },
};
const slot = { width: 110, height: 127 };
const photo = { width: 1000, height: 2000 };

function frameOf() {
  const style = screen.getByTestId('piece', { includeHiddenElements: true }).props.style;
  return Object.assign({}, ...[style].flat(3).filter(Boolean));
}

describe('<CutoutImage /> on its way to the rail', () => {
  afterEach(() => jest.restoreAllMocks());

  test('starts where the piece was in the photo', async () => {
    await render(
      <CutoutImage cutout={cutout} frame={slot} photo={photo} growMs={1200} testID="piece" />,
    );
    expect(frameOf()).toMatchObject(cutoutFrame(slot, photo, cutout.box) ?? {});
  });

  test('with reduced motion it is the slot’s size at once, as pieces in the closet', async () => {
    jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
    await render(
      <CutoutImage cutout={cutout} frame={slot} photo={photo} growMs={1200} testID="piece" />,
    );
    expect(frameOf()).toMatchObject({ left: 0, top: 0, ...slot });
  });

  test('the whole slot without a box', async () => {
    await render(
      <CutoutImage
        cutout={{ ...cutout, box: null }}
        frame={slot}
        photo={photo}
        growMs={1200}
        testID="piece"
      />,
    );
    expect(frameOf()).toMatchObject({ left: 0, top: 0, ...slot });
  });
});

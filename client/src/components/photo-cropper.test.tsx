import { fireEvent, render, screen } from '@testing-library/react-native';

import i18n from '@/i18n';

import { PhotoCropper, toPixels } from './photo-cropper';

jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

beforeEach(async () => {
  await i18n.changeLanguage('en');
});

test('turns the frame on screen into photo pixels, inside the photo', () => {
  const photo = { width: 1200, height: 1600 };
  expect(toPixels({ x: 30, y: 40, width: 150, height: 200 }, 0.25, photo)).toEqual({
    x: 120,
    y: 160,
    width: 600,
    height: 800,
  });
  // A frame dragged to the very edge never reaches past it.
  expect(toPixels({ x: 200, y: 300, width: 200, height: 200 }, 0.25, photo)).toEqual({
    x: 800,
    y: 1200,
    width: 400,
    height: 400,
  });
});

test('closes without cropping on cancel', async () => {
  const onCancel = jest.fn();
  const onDone = jest.fn();
  await render(<PhotoCropper uri="file:///photo.jpg" onCancel={onCancel} onDone={onDone} />);
  expect(screen.getByRole('header', { name: 'Crop to the item' })).toBeOnTheScreen();
  fireEvent.press(screen.getByRole('button', { name: 'Cancel' }));
  expect(onCancel).toHaveBeenCalled();
  expect(onDone).not.toHaveBeenCalled();
});

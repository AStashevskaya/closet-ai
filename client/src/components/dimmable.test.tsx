import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import * as Reanimated from 'react-native-reanimated';

import { durations } from '@/motion';

import { Dimmable, DIMMED_OPACITY } from './dimmable';

// `toHaveStyle` isn't typed for Reanimated's transition properties.
const pictures = () => StyleSheet.flatten(screen.getByTestId('pictures').props.style);

afterEach(() => jest.restoreAllMocks());

test('fades pictures down over a short transition', async () => {
  await render(<Dimmable dimmed testID="pictures" />);
  expect(pictures()).toMatchObject({
    opacity: DIMMED_OPACITY,
    transitionDuration: durations.state,
  });
});

test('leaves pictures clear when not dimmed', async () => {
  await render(<Dimmable dimmed={false} testID="pictures" />);
  expect(pictures()).toMatchObject({ opacity: 1 });
});

test('changes at once with Reduce Motion', async () => {
  jest.spyOn(Reanimated, 'useReducedMotion').mockReturnValue(true);
  await render(<Dimmable dimmed testID="pictures" />);
  expect(pictures()).toMatchObject({ opacity: DIMMED_OPACITY, transitionDuration: 0 });
});

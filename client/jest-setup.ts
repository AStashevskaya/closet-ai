// Gesture Handler's native module, replaced with the mock it ships for tests.
import 'react-native-gesture-handler/jestSetup';

// Reanimated and Worklets need native modules, so tests use the mocks they ship.
// The Reanimated mock leaves out a few helpers we use; they're filled in here.
jest.mock('react-native-worklets', () => require('react-native-worklets/src/mock'));
jest.mock('react-native-reanimated', () => {
  const Reanimated = require('react-native-reanimated/mock');
  return {
    ...Reanimated,
    useReducedMotion: () => false,
    cubicBezier: () => 'ease-out',
  };
});

// Safe-area insets come from a provider at the app's root; tests render screens without it.
jest.mock(
  'react-native-safe-area-context',
  () => jest.requireActual('react-native-safe-area-context/jest/mock').default,
);

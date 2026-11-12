import { isLaunching, launchDone, launchRail, offerLaunchRail, onLaunchRail } from './launch';

describe('the launch hand-off', () => {
  test('hands the curtain a way to measure the first rail, until the curtain has gone', () => {
    const heard = jest.fn();
    const off = onLaunchRail(heard);
    expect(isLaunching()).toBe(true);

    const measure = jest.fn();
    const takeBack = offerLaunchRail(measure);
    expect(launchRail()).toBe(measure);
    expect(heard).toHaveBeenCalledTimes(1);
    off();
    // The rail went (the closet unmounted): nothing to land on.
    takeBack();
    expect(launchRail()).toBeNull();

    launchDone();
    expect(isLaunching()).toBe(false);
    // A rail laid out later (scrolled to, a new category) is no longer the launch's business.
    offerLaunchRail(measure);
    expect(launchRail()).toBeNull();
  });
});

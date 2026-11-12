import { isLaunching, launchDone, launchRailY, onLaunchRail, reportLaunchRail } from './launch';

describe('the launch hand-off', () => {
  test('tells the curtain where the first rail is, until the curtain has gone', () => {
    const heard = jest.fn();
    const off = onLaunchRail(heard);
    expect(isLaunching()).toBe(true);

    reportLaunchRail(212);
    expect(launchRailY()).toBe(212);
    expect(heard).toHaveBeenCalledTimes(1);
    off();

    launchDone();
    expect(isLaunching()).toBe(false);
    expect(launchRailY()).toBeNull();
    // A rail laid out later (scrolled to, a new category) is no longer the launch's business.
    reportLaunchRail(400);
    expect(launchRailY()).toBeNull();
  });
});

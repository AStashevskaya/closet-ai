import { pickCover } from './pick-cover';

const look = (key: string) => ({ key, url: `/api/inspiration/photo?key=${key}`, createdAt: '' });
const DAY = 24 * 60 * 60 * 1000;

test('covers the screen with a saved look, a different one each day', () => {
  const looks = [look('a'), look('b'), look('c')];
  expect(pickCover(looks, 0)?.key).toBe('a');
  expect(pickCover(looks, DAY + 5)?.key).toBe('b');
  expect(pickCover(looks, 3 * DAY)?.key).toBe('a');
});

test('falls back to the bright block when nothing is saved', () => {
  expect(pickCover([])).toBeNull();
});

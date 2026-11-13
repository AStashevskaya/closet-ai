import * as SecureStore from 'expo-secure-store';

// The first piece she photographs for the closet (owner, 2026-11-12, prototype
// `~/Desktop/closet/wrinkle-lab/design-first-photo`, A + B): testers didn't know how to shoot a
// piece or what the photo would become. Two things are shown once per account on this phone: the
// hint before the first shot (A) and the lesson in "Hang it up" after it (B). The keys carry her
// user id, so another account on the same phone (or hers after a session that expired without a
// sign-out) keeps its own state. Signing out or deleting the account clears hers, and a closet
// that already has pieces marks both done, so someone who signs back in to a full closet isn't
// taught again.
const HINT_KEY = 'firstPhoto.hintSeen';
const LESSON_KEY = 'firstPhoto.lessonSeen';

// SecureStore keys take only letters, digits, ".", "-" and "_".
const keyFor = (base: string, userId: string) =>
  `${base}.${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

// Read synchronously, so the screen opens on the right thing without a flash. A store that can't
// be read, or no one signed in, counts as seen: a lost hint is better than one on every photo.
function seen(base: string, userId: string | undefined) {
  if (!userId) return true;
  try {
    return Boolean(SecureStore.getItem(keyFor(base, userId)));
  } catch {
    return true;
  }
}

async function remember(base: string, userId: string | undefined) {
  if (!userId) return;
  try {
    await SecureStore.setItemAsync(keyFor(base, userId), '1');
  } catch {
    // Shown again next time, which is harmless.
  }
}

export const firstPhotoHintSeen = (userId: string | undefined) => seen(HINT_KEY, userId);
export const firstPhotoLessonSeen = (userId: string | undefined) => seen(LESSON_KEY, userId);
export const rememberFirstPhotoHint = (userId: string | undefined) => remember(HINT_KEY, userId);
export const rememberFirstPhotoLesson = (userId: string | undefined) =>
  remember(LESSON_KEY, userId);

// Her closet has pieces (only ever hers: the server lists her own items): she's past her first
// photo, whatever this phone remembers.
export async function firstPhotoDone(userId: string | undefined) {
  if (!firstPhotoHintSeen(userId)) await remember(HINT_KEY, userId);
  if (!firstPhotoLessonSeen(userId)) await remember(LESSON_KEY, userId);
}

// Signing out or deleting the account: her state on this phone goes with her.
export async function forgetFirstPhoto(userId: string | undefined) {
  if (!userId) return;
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(keyFor(HINT_KEY, userId)),
      SecureStore.deleteItemAsync(keyFor(LESSON_KEY, userId)),
    ]);
  } catch {
    // Nothing to forget.
  }
}

import * as SecureStore from 'expo-secure-store';

// The first piece she photographs for the closet (owner, 2026-11-12, prototype
// `~/Desktop/closet/wrinkle-lab/design-first-photo`, A + B): testers didn't know how to shoot a
// piece or what the photo would become. Two things are shown once on this phone: the hint before
// the first shot (A) and the lesson in "Hang it up" after it (B). Both are forgotten on sign-out,
// and a closet that already has pieces marks them done, so someone who signs back in to a full
// closet isn't taught again.
const HINT_KEY = 'firstPhoto.hintSeen';
const LESSON_KEY = 'firstPhoto.lessonSeen';

// Read synchronously, so the screen opens on the right thing without a flash. A store that can't
// be read counts as seen: a lost hint is better than one shown on every photo.
function seen(key: string) {
  try {
    return Boolean(SecureStore.getItem(key));
  } catch {
    return true;
  }
}

async function remember(key: string) {
  try {
    await SecureStore.setItemAsync(key, '1');
  } catch {
    // Shown again next time, which is harmless.
  }
}

export const firstPhotoHintSeen = () => seen(HINT_KEY);
export const firstPhotoLessonSeen = () => seen(LESSON_KEY);
export const rememberFirstPhotoHint = () => remember(HINT_KEY);
export const rememberFirstPhotoLesson = () => remember(LESSON_KEY);

// Her closet has pieces: she's past her first photo, whatever this phone remembers.
export async function firstPhotoDone() {
  if (!firstPhotoHintSeen()) await remember(HINT_KEY);
  if (!firstPhotoLessonSeen()) await remember(LESSON_KEY);
}

// Signing out or deleting the account: whoever signs in next on this phone starts afresh.
export async function forgetFirstPhoto() {
  try {
    await Promise.all([
      SecureStore.deleteItemAsync(HINT_KEY),
      SecureStore.deleteItemAsync(LESSON_KEY),
    ]);
  } catch {
    // Nothing to forget.
  }
}

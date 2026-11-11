import { Redirect } from 'expo-router';

import { BRANDS_OPEN } from '@/lib/features';
import { TheEdit } from '@/screens/the-edit';

// Closed for now: a link straight here goes to the closet instead.
export default function TheEditScreen() {
  if (!BRANDS_OPEN) return <Redirect href="/" />;
  return <TheEdit />;
}

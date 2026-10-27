import type { OutfitMood } from '@closet-ai/shared';
import { useLocalSearchParams } from 'expo-router';

import { Styled } from '@/screens/styled';

// `id`: the request; `item`: the closet piece it asks about, with its name and photo (the screen
// pushing this one has them, so the thread hangs at once); `mood`: the one it keeps to, if any.
export default function StyledRoute() {
  const { id, item, name, photoUrl, cutoutUrl, mood } = useLocalSearchParams<{
    id: string;
    item: string;
    name: string;
    photoUrl?: string;
    cutoutUrl?: string;
    mood?: OutfitMood;
  }>();
  return (
    <Styled requestId={id} piece={{ id: item, name, photoUrl, cutoutUrl }} mood={mood ?? null} />
  );
}

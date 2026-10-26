import { itemCategory } from '@closet-ai/shared';
import { Redirect, useLocalSearchParams } from 'expo-router';

import { ClosetCategory } from '@/screens/closet/category';

// "See all" from a closet rail. An unknown category (an old or mistyped link) goes to the closet.
export default function ClosetCategoryRoute() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const parsed = itemCategory.safeParse(category);
  if (!parsed.success) return <Redirect href="/" />;
  return <ClosetCategory category={parsed.data} />;
}

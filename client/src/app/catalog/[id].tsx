import { Redirect, useLocalSearchParams } from 'expo-router';

import { BRANDS_OPEN } from '@/lib/features';
import { CatalogItemScreen } from '@/screens/catalog-item';

// Brands are closed for now: a link straight to a brand's piece goes to the closet instead.
export default function CatalogItemRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  if (!BRANDS_OPEN) return <Redirect href="/" />;
  return <CatalogItemScreen id={id} />;
}

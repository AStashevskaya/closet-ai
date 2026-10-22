import { useLocalSearchParams } from 'expo-router';

import { CatalogItemScreen } from '@/screens/catalog-item';

export default function CatalogItemRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CatalogItemScreen id={id} />;
}

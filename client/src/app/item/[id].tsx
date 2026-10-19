import { useLocalSearchParams } from 'expo-router';

import { ItemScreen } from '@/screens/item';

export default function ItemRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ItemScreen id={id} />;
}

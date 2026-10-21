import { useLocalSearchParams } from 'expo-router';

import { WearWith } from '@/screens/wear-with';

export default function WearWithScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <WearWith id={id} />;
}

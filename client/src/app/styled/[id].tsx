import { Redirect, useLocalSearchParams } from 'expo-router';

import { readStyledParams } from '@/lib/styled';
import { Styled } from '@/screens/styled';

// A closet piece's request on the thread: its name and photo come along (lib/styled), so the
// thread hangs at once. Without them (a link from elsewhere) the outfits screen shows the request.
export default function StyledRoute() {
  const params = useLocalSearchParams();
  const styled = readStyledParams(params);
  if (!styled) {
    const id = Array.isArray(params.id) ? params.id[0] : params.id;
    return <Redirect href={{ pathname: '/wear-with/[id]', params: { id: id ?? '' } }} />;
  }
  // Keyed by the request: the same screen opened for another one starts afresh.
  return <Styled key={styled.requestId} {...styled} />;
}

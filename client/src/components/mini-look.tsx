import { StyleSheet, View } from 'react-native';

import { BarePiece } from '@/components/bare-piece';

export const MINI_LOOK_WIDTH = 72;
export const MINI_LOOK_HEIGHT = 118;

type Piece = { id: string; category: string; photoUrl?: string | null; cutoutUrl?: string | null };

// A look, small: the top or dress (a coat behind it), the bottom under it, the shoes at the foot.
// Bags and other accessories are left out at this size. On the week's recap and in "a new life
// for this piece".
export function MiniLook({
  items,
  headers,
}: {
  items: Piece[];
  headers: Record<string, string> | undefined;
}) {
  const of = (category: string) => items.find((item) => item.category === category);
  const dress = of('dress');
  const top = of('top');
  const bottom = of('bottom');
  const shoes = of('shoes');
  const coat = of('outerwear');
  return (
    <View style={styles.mini}>
      {coat && <BarePiece item={coat} headers={headers} style={styles.coat} />}
      {dress ? (
        <BarePiece item={dress} headers={headers} style={styles.dress} />
      ) : (
        <>
          {top && <BarePiece item={top} headers={headers} style={styles.top} />}
          {bottom && <BarePiece item={bottom} headers={headers} style={styles.bottom} />}
        </>
      )}
      {shoes && <BarePiece item={shoes} headers={headers} style={styles.shoes} />}
    </View>
  );
}

const styles = StyleSheet.create({
  mini: {
    width: MINI_LOOK_WIDTH,
    height: MINI_LOOK_HEIGHT,
  },
  coat: {
    position: 'absolute',
    start: 0,
    top: 0,
    width: 52,
    height: 70,
  },
  top: {
    position: 'absolute',
    start: 12,
    top: 0,
    width: 54,
    height: 54,
  },
  dress: {
    position: 'absolute',
    start: 10,
    top: 0,
    width: 56,
    height: 92,
  },
  bottom: {
    position: 'absolute',
    start: 16,
    top: 44,
    width: 48,
    height: 52,
  },
  shoes: {
    position: 'absolute',
    start: 18,
    top: 96,
    width: 36,
    height: 22,
  },
});

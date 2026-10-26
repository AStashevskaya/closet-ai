import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '@/theme';

// What a piece hangs from on a closet rail: a coat hanger for tops, dresses and outerwear, a clip
// hanger for bottoms, a bare hook for bags and accessories, a small clip for a photo print still
// waiting for its cut-out.
export type HangerKind = 'coat' | 'clip' | 'hook' | 'print';

export const HANGER_WIDTH = 84;
export const HANGER_HEIGHT = 34;
// Where the rail runs through the hook, from the top of the hanger: the point a piece turns
// around when it swings.
export const HANGER_PIVOT_Y = 3;

// The hook over the rail, the same for every kind; each kind carries on from its end.
const HOOK = 'M37.5 5C37.5 2 39.5.6 42 .6s4.5 1.6 4.5 4c0 2.8-4.5 3.4-4.5 6.9';

// One thin stroke on an 84×34 grid, like the icons.
export function Hanger({ kind }: { kind: HangerKind }) {
  return (
    <Svg
      width={HANGER_WIDTH}
      height={HANGER_HEIGHT}
      viewBox={`0 0 ${HANGER_WIDTH} ${HANGER_HEIGHT}`}
      fill="none"
      stroke={colors.text}
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {kind === 'coat' && (
        <Path d={`${HOOK}V13.5L6 29.5c-2.5 1.3-1.8 3.5 1 3.5h70c2.8 0 3.5-2.2 1-3.5L42 13.5`} />
      )}
      {kind === 'clip' && (
        <>
          <Path d={`${HOOK}V18M14 18h56M18 18v4M66 18v4`} />
          <Rect x={15} y={22} width={6} height={7} rx={1} />
          <Rect x={63} y={22} width={6} height={7} rx={1} />
        </>
      )}
      {kind === 'hook' && <Path d={`${HOOK}V14`} />}
      {kind === 'print' && (
        <>
          <Path d={`${HOOK}V20`} />
          <Rect x={36} y={19} width={12} height={9} rx={1.5} />
        </>
      )}
    </Svg>
  );
}

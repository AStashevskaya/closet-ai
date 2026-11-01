import type { ColorValue } from 'react-native';
import Svg, { Path } from 'react-native-svg';

// Thin stroke icons from the design canvas, drawn on a 24×24 grid.
const PATHS = {
  hanger: 'M12 7a2 2 0 1 1 2-2M12 7v2L3 16h18l-9-7',
  look: 'M8 3l-4 3 2 3 2-1v13h8V8l2 1 2-3-4-3c-1 2-2.5 3-4 3S9 5 8 3z',
  spark: 'M12 3l2 6 6 2-6 2-2 6-2-6-6-2 6-2z',
  trend: 'M3 17l6-6 4 4 8-8M15 7h6v6',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 7.5h.01',
  chat: 'M4 5h16v11H9l-5 4V5z',
  store: 'M4 9l1.5-5h13L20 9M4 9h16M4 9v11h16V9M9 20v-6h6v6',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  home: 'M4 11l8-7 8 7v9h-5v-6H9v6H4z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c1.5-4 4.5-6 8-6s6.5 2 8 6',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  chevron: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'M7 7l10 10M17 7L7 17',
  check: 'M5 12.5l4.5 4.5L19 7',
  // A quarter turn clockwise.
  rotate: 'M20 12a8 8 0 1 1-2.34-5.66L20 8.5M20 3.5v5h-5',
  crop: 'M7 3v14h14M3 7h14v14',
  camera:
    'M3 8.5h3.6l1.7-2.5h7.4l1.7 2.5H21V19H3zM12 16.6a3.4 3.4 0 1 0 0-6.8 3.4 3.4 0 0 0 0 6.8z',
} as const;

export type IconName = keyof typeof PATHS;

type Props = {
  name: IconName;
  color: ColorValue;
  size?: number;
  fill?: ColorValue;
  strokeWidth?: number;
};

export function Icon({ name, color, size = 22, fill = 'none', strokeWidth = 1.3 }: Props) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <Path
        d={PATHS[name]}
        fill={fill}
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// The app icon: the hanger without the bead, glossy (2026-11-12).
const HOOK = 'M512 430 V394 C512 364 468 352 468 320 C468 290 490 270 516 270 C544 270 566 290 566 318 C566 336 558 348 548 356';
const BODY = 'M512 430 L190 640 C162 658 172 694 208 694 H816 C852 694 862 658 834 640 Z';
function svg({ mode = 'light', bg = true, size = 1024, scale = 1, noArt = false }) {
  const dark = mode === 'dark', tint = mode === 'tint';
  const bgTop = dark ? '#2A2024' : '#E6EEF8', bgBot = dark ? '#120C0E' : '#C5D7EC';
  const lineA = dark ? '#F7CFD9' : tint ? '#FFFFFF' : '#7A2A3A', lineB = dark ? '#D98CA2' : tint ? '#D8D8D8' : '#3A0E18';
  const g = `<g fill="none" stroke-linecap="round" stroke-linejoin="round">`;
  const shape = (stroke, w, extra = '') => `${g}<path d="${HOOK}" stroke="${stroke}" stroke-width="${w}" ${extra}/><path d="${BODY}" stroke="${stroke}" stroke-width="${w}" ${extra}/></g>`;
  const art = `
  <g transform="translate(512 512) scale(${scale}) translate(-512 -490)">
    ${tint ? '' : `<g filter="url(#shadow)" transform="translate(0 14)">${shape(dark ? '#000' : '#5B7FA8', 46, 'opacity="0.35"')}</g>`}
    ${shape('url(#metal)', 46)}
    ${!tint ? `<g transform="translate(-4 -8)">${shape("url(#sheen)", 9)}</g>` : ''}
  </g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="${bgTop}"/><stop offset="1" stop-color="${bgBot}"/></linearGradient>
    <radialGradient id="glow" cx="0.3" cy="0.18" r="0.75"><stop offset="0" stop-color="#FFFFFF" stop-opacity="${dark ? 0.10 : 0.75}"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/></radialGradient>
    <linearGradient id="metal" x1="0" y1="0" x2="0.25" y2="1"><stop offset="0" stop-color="${lineA}"/><stop offset="1" stop-color="${lineB}"/></linearGradient>
    <linearGradient id="sheen" x1="0" y1="0" x2="1" y2="0.6"><stop offset="0" stop-color="#FFFFFF" stop-opacity="${dark ? 0.55 : 0.8}"/><stop offset="0.5" stop-color="#FFFFFF" stop-opacity="${dark ? 0.08 : 0.15}"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="${dark ? 0.4 : 0.6}"/></linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%"><feGaussianBlur stdDeviation="9"/></filter>
  </defs>
  ${bg ? (tint ? '<rect width="1024" height="1024" fill="#000"/>' : '<rect width="1024" height="1024" fill="url(#bg)"/><rect width="1024" height="1024" fill="url(#glow)"/>') : ''}
  ${noArt ? '' : art}
</svg>`;
}
module.exports = { svg };

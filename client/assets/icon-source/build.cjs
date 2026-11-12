// Renders the app icons: node client/assets/icon-source/build.cjs <path to sharp> client/assets/images
// (sharp from server/node_modules, so the client takes no dependency).
const sharp = require(process.argv[2]);
const out = process.argv[3];
const { svg } = require('./art.cjs');
const r = (o, file, flat) => { let s = sharp(Buffer.from(svg(o))); if (flat) s = s.flatten({ background: '#D6E4F1' }).removeAlpha(); return s.png().toFile(`${out}/${file}`); };
(async () => {
  await r({ mode: 'light' }, 'icon.png', true);
  await r({ mode: 'light' }, 'icon-ios-light.png', true);
  await r({ mode: 'dark' }, 'icon-ios-dark.png', true);
  await r({ mode: 'tint', bg: false }, 'icon-ios-tinted.png');
  await r({ mode: 'light', bg: false, size: 512, scale: 0.62 }, 'android-icon-foreground.png');
  await r({ mode: 'light', size: 512, noArt: true }, 'android-icon-background.png', true);
  await r({ mode: 'tint', bg: false, size: 512, scale: 0.62 }, 'android-icon-monochrome.png');
  await r({ mode: 'light', bg: false }, 'splash-icon.png');
})();

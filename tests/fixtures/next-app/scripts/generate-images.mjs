// One-shot generator for the deterministic PNGs committed in public/.
// Uses pngjs from the toolkit's ROOT node_modules (the fixture does not depend on it):
//   node tests/fixtures/next-app/scripts/generate-images.mjs
import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const rootRequire = createRequire(join(here, '../../../../package.json'));
const { PNG } = rootRequire('pngjs');

function checkerboard(width, height, cell, colorA, colorB) {
  const png = new PNG({ width, height });
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const color = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0 ? colorA : colorB;
      const i = (y * width + x) * 4;
      png.data[i] = color[0];
      png.data[i + 1] = color[1];
      png.data[i + 2] = color[2];
      png.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const publicDir = join(here, '../public');
writeFileSync(
  join(publicDir, 'lazy.png'),
  checkerboard(320, 180, 20, [37, 99, 235], [219, 234, 254]),
);
writeFileSync(
  join(publicDir, 'poster.png'),
  checkerboard(320, 180, 20, [22, 163, 74], [220, 252, 231]),
);
console.log('wrote lazy.png and poster.png');

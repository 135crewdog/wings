// Hawaii's tiles (terrain/hawaii/) for the headless tests: every tile decoded
// as the app decodes it, and the ground the flight model reads from them
// (src/sim/hawaii.js).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../terrain/png.mjs';
import { createHawaii, decodeTile } from '../src/sim/hawaii.js';

export const dir = fileURLToPath(new URL('../terrain/hawaii/', import.meta.url));
export const index = JSON.parse(readFileSync(dir + 'index.json', 'utf8'));

const sheets = new Map();
export const sheet = (name) => sheets.get(name) ?? sheets.set(name, readFileSync(dir + name)).get(name);
export const tiles = new Map();
for (const [level, i, j, name, ho, hl] of index.tiles) tiles.set(`${level}/${i}/${j}`, { name, ho, hl });
const decoded = new Map();
export const tileAt = (level, i, j) => {
  const k = `${level}/${i}/${j}`, t = tiles.get(k);
  if (!t) return null;
  if (!decoded.has(k)) decoded.set(k, decodeTile(decodePng(sheet(t.name).subarray(t.ho, t.ho + t.hl)).rgb, index, 3));
  return decoded.get(k);
};
/** Hawaii's ground, as the flight model reads it. */
export const hawaii = createHawaii(index, tileAt);

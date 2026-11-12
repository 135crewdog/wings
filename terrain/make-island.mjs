// Shapes the island of docs/island.md and writes its height map:
//   node terrain/make-island.mjs
// writes terrain/island.png (the heights) and terrain/island.json (where it
// lies, the lochs, and the places landmarks stand). Run by hand when the
// island's shape changes; the app only ever reads the two files.
// Metres; north and east of the island's middle.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';

export const SIZE = 1024, POST = 44;                 // posts each way, and metres between them
// The recipe below is drawn for an island 40 miles across. SCALE shrinks the whole plan to the size wanted:
// 0.5 is 20 miles. Heights stay as they are, and so do the things with a size of their own (the base, the cove,
// the castle's rock), which are written in real metres times `real`.
export const SCALE = 0.5, real = 1 / SCALE;
export const NORTH0 = (SIZE - 1) * POST / 2, EAST0 = -NORTH0;   // the north-west corner
export const MIN = -40, STEP = 0.25;                 // heights are stored in steps of 0.25 m above -40 m
const FT = 0.3048;

// ---- the places (docs/island.md) ----
const PLAN_BASE = { north: -3000, east: 22000 };
export const BASE = { north: PLAN_BASE.north * SCALE, east: PLAN_BASE.east * SCALE, heading: 280, height: 30 * FT };   // the runway's middle; flights take off on 28
const LOCH = { level: 300, width: 450 * real, path: [[22500, -3500], [23300, 500], [22400, 4500], [22900, 7500]] };
const PLAN_CASTLE = { north: 24000, east: 1300 + 150 * real };
export const CASTLE = { north: PLAN_CASTLE.north * SCALE, east: PLAN_CASTLE.east * SCALE, height: LOCH.level + 80 };   // a crag on the loch's north shore
// The glen that leads out of the castle's bowl, winding so the castle can't be seen up it.
const GLEN = [[22500, -3500], [21200, -7500], [17500, -9200], [14200, -6500], [10500, -8800], [6000, -8000]];
export const VIADUCT = { north: 17500 * SCALE, east: -9200 * SCALE };   // it spans the glen here
const COVE = { east: -4000, radius: 350 * real };
const DOOR = { east: -5700 };                            // a mile west of the cove, as the real ones lie

// ---- noise: the same every run ----
const hash = (i, j, s) => { let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const fade = (t) => t * t * (3 - 2 * t);
function noise(x, y, s = 0) {   // smooth, 0..1
  const i = Math.floor(x), j = Math.floor(y), u = fade(x - i), v = fade(y - j);
  return (hash(i, j, s) * (1 - u) + hash(i + 1, j, s) * u) * (1 - v) + (hash(i, j + 1, s) * (1 - u) + hash(i + 1, j + 1, s) * u) * v;
}
function fbm(x, y, octaves, s = 0) {   // rolling ground, about -1..1
  let sum = 0, amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * (2 * noise(x, y, s + o) - 1); total += amp; x *= 2.03; y *= 2.03; amp *= 0.5; }
  return sum / total;
}
function ridged(x, y, octaves, s = 0) {   // sharp ridges with valleys between, 0..1
  let sum = 0, amp = 1, total = 0, weight = 1;
  for (let o = 0; o < octaves; o++) {
    let r = 1 - Math.abs(2 * noise(x, y, s + o) - 1); r *= r;
    sum += amp * r * weight; total += amp; weight = Math.min(1, r * 1.6); x *= 2.07; y *= 2.07; amp *= 0.5;
  }
  return sum / total;
}
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const smooth = (a, b, v) => fade(clamp((v - a) / (b - a), 0, 1));
// Distance from a point to a path of straight legs, and how far along the path (0..1) the nearest point is.
function toPath(path, n, e) {
  let best = Infinity, along = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [an, ae] = path[i], [bn, be] = path[i + 1], dn = bn - an, de = be - ae;
    const t = clamp(((n - an) * dn + (e - ae) * de) / (dn * dn + de * de), 0, 1), d = Math.hypot(n - an - t * dn, e - ae - t * de);
    if (d < best) { best = d; along = (i + t) / (path.length - 1); }
  }
  return [best, along];
}

// ---- the coast: how far inland a point is (negative out at sea) ----
const coastRadius = (bearing) => 36000 * (1 + 0.05 * Math.cos(2 * bearing + 0.6) + 0.035 * Math.cos(3 * bearing - 1.1) + 0.02 * Math.cos(5 * bearing + 2));
const southCoast = (east) => -coastRadius(Math.atan2(east, -1) ) ;   // roughly how far north the south coast lies (negative)
function inland(n, e) {
  const south = smooth(-22000, -30000, n);   // the south coast runs smooth; the rest is ragged
  let d = coastRadius(Math.atan2(e, n)) - Math.hypot(n, e) + (1 - south) * (1500 * fbm(n / 9000, e / 9000, 4, 40) + 500 * fbm(n / 2500, e / 2500, 3, 50));
  d += 250 * real * Math.exp(-(((e - DOOR.east) / (160 * real)) ** 2)) * south;   // the Door's headland
  return d;
}

/** The land's height at a point (real metres north and east), before it is stored. */
export function shape(n, e) {
  n /= SCALE; e /= SCALE;   // from here on, the plan's own metres
  const d = inland(n, e);
  if (d < -2500) return MIN;
  const line = 7500 + 2500 * fbm(e / 15000, 3.3, 2, 7);   // where the highlands begin
  const high = smooth(line - 2500, line + 6000, n) * smooth(0, 3000, d);
  const south = smooth(-22000, -29000, n);
  const fields = smooth(5000, 11000, e) * (1 - high) * smooth(-27000, -20000, n);

  // Lowlands: the fields nearly flat, the moor and the west in low hills.
  let h = 8 + Math.min(d * 0.002, 30) * (1 - fields) + 3 * fbm(n / 2500, e / 2500, 3, 11);
  h += (1 - fields) * smooth(500, 5000, d) * (230 + 270 * fbm(n / 7000, e / 7000, 4, 12)) * (0.25 + 0.75 * noise(n / 16000, e / 16000, 13)) * (1 - 0.6 * south);
  // The south: chalk downs that end at the sea in cliffs.
  h += south * Math.exp(-Math.max(d, 0) / 6000) * (105 + 35 * fbm(n / 3000, e / 3000, 3, 14)) * smooth(0, 90, d);
  // Highlands: ridges and glens, bigger than life.
  const wn = n + 2600 * fbm(n / 6000, e / 6000, 3, 20), we = e + 2600 * fbm(n / 6000, e / 6000, 3, 21);
  const rock = ridged(wn / 8500, we / 8500, 6, 22);
  h += high * (90 + 2100 * Math.pow(rock, 1.7) * (0.75 + 0.5 * noise(n / 20000, e / 20000, 23)));
  // A wall of peaks south of the castle's bowl, so it can't be seen from the lowlands.
  const wall = Math.exp(-(((n - 18800 - 900 * Math.sin(e / 3500)) / 1700) ** 2)) * smooth(-14000, -9000, e) * smooth(15000, 10000, e);
  h += wall * high * 1100 * (0.45 + ridged(wn / 3800, we / 3800, 4, 24));

  // The glen out of the bowl, then the loch: each cuts down to its floor, with steep sides.
  // A ring of peaks round the loch, so the castle stands in a bowl.
  const [ld] = toPath(LOCH.path, n, e);
  h += high * 950 * Math.exp(-(((ld - 3300) / 1500) ** 2)) * (0.5 + ridged(wn / 3200, we / 3200, 4, 25));
  if (h > 1750) h = 1750 + 600 * Math.tanh((h - 1750) / 600);   // the tops stay under 7,700 feet
  const [gd, ga] = toPath(GLEN, n, e);
  // The glen leaves the loch over a lip of ground above the water, then runs downhill.
  const floor = LOCH.level + 15 - 200 * Math.max(0, ga - 0.14) / 0.86 + 10 * fbm(n / 900, e / 900, 2, 30) * smooth(0.14, 0.24, ga);
  if (h > floor) h = floor + (h - floor) * smooth(150 * real, 1500, gd);
  if (h > LOCH.level - 20) h = LOCH.level - 20 + (h - LOCH.level + 20) * smooth(LOCH.width, LOCH.width + 1300, ld);
  // The castle's crag: a flat-topped rock above the water.
  const crag = Math.hypot(n - PLAN_CASTLE.north, e - PLAN_CASTLE.east);
  h = Math.max(h, CASTLE.height - Math.max(0, crag - 150 * real) * 0.9 * SCALE);

  // The base: dead flat, easing into the fields round it.
  const a = (BASE.heading * Math.PI) / 180, rn = n - PLAN_BASE.north, re = e - PLAN_BASE.east;
  const along = Math.abs(rn * Math.cos(a) + re * Math.sin(a)), across = Math.abs(-rn * Math.sin(a) + re * Math.cos(a));
  const flat = 1 - smooth(0, 1200 * real, Math.max(along - 2200 * real, across - 900 * real));
  h += flat * (BASE.height - h);

  // The shore: land runs down to the water, and the seabed falls away.
  if (d < 0) return Math.max(MIN, d * 0.03);
  h *= south > 0.5 ? 1 : smooth(0, 300, d) * 0.92 + 0.08;
  h = Math.max(h, 0.6);
  // The cove: a round bay behind a narrow mouth in the cliffs.
  const coveN = coveNorth, cd = Math.hypot(n - coveN, e - COVE.east);
  const mouth = Math.abs(e - COVE.east) < 90 * real && n < coveN;
  if (cd < COVE.radius + 160 * real || mouth) h = Math.min(h, mouth ? -6 : -6 + Math.max(0, cd - COVE.radius) * 0.9 * SCALE);
  return h;
}
// Where the cove lies: just inside the south coast.
let coveNorth = -36000;
for (let n = -30000; n > -40000; n -= 20) if (inland(n, COVE.east) < 0) { coveNorth = n + COVE.radius + 200 * real; break; }
export const COVE_AT = { north: coveNorth * SCALE, east: COVE.east * SCALE, radius: COVE.radius * SCALE };
let doorNorth = -36000;
for (let n = -30000; n > -40000; n -= 20) if (inland(n, DOOR.east) < 0) { doorNorth = n + 20; break; }
export const DOOR_AT = { north: doorNorth * SCALE, east: DOOR.east * SCALE };

// The loch's box: its path, and room for its shores.
const around = (i) => LOCH.path.map((p) => p[i]), ROOM = LOCH.width + 1300;   // as far as the loch shapes the ground
const lochBox = { south: (Math.min(...around(0)) - ROOM) * SCALE, north: (Math.max(...around(0)) + ROOM) * SCALE, west: (Math.min(...around(1)) - ROOM) * SCALE, east: (Math.max(...around(1)) + ROOM) * SCALE };

export const region = () => ({
  image: 'island.png', size: SIZE, post: POST, north0: NORTH0, east0: EAST0, min: MIN, step: STEP, seabed: MIN,
  lochs: [{ level: LOCH.level, ...lochBox }],
  // Where things stand: metres north and east, and height above sea level.
  sites: { base: BASE, castle: CASTLE, viaduct: VIADUCT, cove: COVE_AT, door: DOOR_AT },
});

/** Every post's height, row by row from the north-west corner, in stored steps. */
export function build() {
  const steps = new Uint16Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    steps[r * SIZE + c] = clamp(Math.round((shape(NORTH0 - r * POST, EAST0 + c * POST) - MIN) / STEP), 0, 65535);
  }
  return steps;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const steps = build(), rgb = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < steps.length; i++) { rgb[i * 3] = steps[i] >> 8; rgb[i * 3 + 1] = steps[i] & 255; }
  const here = (name) => fileURLToPath(new URL(name, import.meta.url));
  const png = encodePng(rgb, SIZE, SIZE);
  writeFileSync(here('island.png'), png);
  writeFileSync(here('island.json'), JSON.stringify(region(), null, 2) + '\n');
  let top = 0; for (const s of steps) top = Math.max(top, s);
  console.log(`island.png ${(png.length / 1e6).toFixed(2)} MB; highest point ${Math.round((MIN + top * STEP) / FT)} ft`);
}

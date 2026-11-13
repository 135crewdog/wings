// Shapes the island of docs/island.md and writes its height map:
//   node terrain/make-island.mjs
// writes terrain/island.png (the heights) and terrain/island.json (where it
// lies, the lochs, and the places landmarks stand). Run by hand when the
// island's shape changes; the app only ever reads the two files.
// Metres; north and east of the island's middle.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';
import { onAirfield, plotAt } from '../src/fields.js';

export const SIZE = 1024, POST = 44;                 // posts each way, and metres between them
// The recipe below is drawn for an island 40 miles across. SCALE shrinks the whole plan to the size wanted:
// 0.5 is 20 miles. It moves where things are, not how big they are: the mountains, the glen, the loch, the base,
// the cove and the castle's rock keep their real sizes (real metres, or real metres times `real` in the plan's),
// so a smaller island has fewer mountains, not steeper ones.
export const SCALE = 0.5, real = 1 / SCALE;
export const NORTH0 = (SIZE - 1) * POST / 2, EAST0 = -NORTH0;   // the north-west corner
export const MIN = -40, STEP = 0.25;                 // heights are stored in steps of 0.25 m above -40 m
export const TREETOPS = 12, CANOPY_STEP = 0.25;      // a wood stands 12 m (40 ft) tall; stored in steps of 0.25 m
const FT = 0.3048;

// ---- the places (docs/island.md) ----
const PLAN_BASE = { north: -3000, east: 22000 };
export const BASE = { north: PLAN_BASE.north * SCALE, east: PLAN_BASE.east * SCALE, heading: 280, height: 30 * FT };   // the runway's middle; flights take off on 28
const LOCH = { level: 300, width: 550 * real, path: [[22500, -3500], [23300, 500], [22400, 4500], [22900, 7500]] };
const PLAN_CASTLE = { north: 23050 + 650 * real, east: 1600 };
export const CASTLE = { north: PLAN_CASTLE.north * SCALE, east: PLAN_CASTLE.east * SCALE, height: LOCH.level + 80 };   // a crag on the loch's north shore
// The glen that leads out of the castle's bowl, winding so the castle can't be seen up it.
const GLEN = [[22500, -3500], [21200, -7500], [17500, -9200], [14200, -6500], [10500, -8800], [6000, -8000]];
export const VIADUCT = { north: 17500 * SCALE, east: -9200 * SCALE };   // it spans the glen here
const COVE = { east: -4000, radius: 350 * real };
const DOOR = { east: -5700 };
// The mountains: metres north and east (real), the top's height, and how far the mountain reaches.
const PEAKS = [
  [15000, -1500, 2320, 4600], [14600, 3300, 2180, 4300], [11900, 7300, 2040, 4400], [8000, 4700, 2260, 4500],   // round the loch: north, north-east, east, south-east
  [7400, 300, 2120, 4000], [8900, -2300, 1960, 2700], [9500, -7600, 2210, 4500], [12900, -5700, 2080, 4200],    // south, south-west (the glen runs round it), west, north-west
  [9000, -11800, 1900, 3900], [8400, 11000, 1860, 3900],                                                        // one alone at each end
  // lower tops between and beyond them, so the whole reads as a range
  [16300, 1000, 1500, 2600], [13600, 6000, 1450, 2500], [10000, 6800, 1400, 2400], [6200, 2600, 1350, 2600], [6300, -5600, 1300, 2500],
  [11800, -9300, 1500, 2800], [14600, -4000, 1550, 2600], [6600, 8200, 1250, 2500], [6800, -9600, 1200, 2500], [11200, 10600, 1300, 2500],
];                            // a mile west of the cove, as the real ones lie

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

// The loch's box: its path, and room for its shores.
const around = (i) => LOCH.path.map((p) => p[i]), ROOM = LOCH.width + 700 * real;
const lochPlan = { south: Math.min(...around(0)) - ROOM, north: Math.max(...around(0)) + ROOM, west: Math.min(...around(1)) - ROOM, east: Math.max(...around(1)) + ROOM };
const lochBox = Object.fromEntries(Object.entries(lochPlan).map(([side, at]) => [side, at * SCALE]));

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
  // Highlands: a handful of big mountains, each placed by hand (real metres), with ridges and corries cut into
  // them and glens between. A ring of them stands round the loch, so the castle is in a bowl.
  const rn = n * SCALE, re = e * SCALE;
  const wn = rn + 1100 * fbm(rn / 3600, re / 3600, 3, 20), we = re + 1100 * fbm(rn / 3600, re / 3600, 3, 21);
  let massif = 0;
  for (const [pn, pe, top, reach] of PEAKS) {
    const t = Math.hypot(wn - pn, we - pe) / (reach * (0.8 + 0.4 * noise(wn / 2200, we / 2200, 26)));
    if (t < 1) massif += ((top - 330) * Math.pow(1 - t, 1.6) * (0.72 + 0.56 * ridged(wn / 2600, we / 2600, 4, 22))) ** 3;
  }
  h += high * (230 + 110 * fbm(rn / 1800, re / 1800, 3, 27) + Math.cbrt(massif));
  const [ld] = toPath(LOCH.path, n, e);
  const [gd, ga] = toPath(GLEN, n, e);
  // The glen leaves the loch over a lip of ground above the water, then runs downhill.
  const floor = LOCH.level + 15 - 200 * Math.max(0, ga - 0.14) / 0.86 + 10 * fbm(n / 900, e / 900, 2, 30) * smooth(0.14, 0.24, ga);
  if (h > floor) h = floor + (h - floor) * smooth(120, 1000, gd * SCALE);
  if (h > LOCH.level - 20) h = LOCH.level - 20 + (h - LOCH.level + 20) * smooth(LOCH.width, LOCH.width + 1400 * real, ld);
  // Round the loch the ground stands above the water, so its shores hold it in wherever the glen or a low col comes near.
  if (ld > LOCH.width + 500 * real && n > lochPlan.south && n < lochPlan.north && e > lochPlan.west && e < lochPlan.east) h = Math.max(h, LOCH.level + 4);
  // The castle's crag: a flat-topped rock above the water.
  const crag = Math.hypot(n - PLAN_CASTLE.north, e - PLAN_CASTLE.east);
  h = Math.max(h, CASTLE.height - Math.max(0, crag - 150 * real) * 0.9 * SCALE);

  // The base: dead flat, easing into the fields round it.
  const a = (BASE.heading * Math.PI) / 180, bn = n - PLAN_BASE.north, be = e - PLAN_BASE.east;
  const along = Math.abs(bn * Math.cos(a) + be * Math.sin(a)), across = Math.abs(-bn * Math.sin(a) + be * Math.cos(a));
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

export const region = () => ({
  image: 'island.png', size: SIZE, post: POST, north0: NORTH0, east0: EAST0, min: MIN, step: STEP, seabed: MIN, canopyStep: CANOPY_STEP,
  lochs: [{ level: LOCH.level, ...lochBox }],
  // Where things stand: metres north and east, and height above sea level.
  sites: { base: BASE, castle: CASTLE, viaduct: VIADUCT, cove: COVE_AT, door: DOOR_AT },
  // For the paint: farmland lies east of this line, and the chalk cliffs south of this one.
  paint: PAINT,
});

const PAINT = { fieldsEast: 6500 * SCALE, chalkSouth: -24000 * SCALE };

/**
 * Whether a post stands in a wood. In the farmland a wood is one of the plots (src/fields.js marks them), kept
 * back from the plot's edge; elsewhere woods grow in patches on the lower, gentler ground. None on the airfield.
 * `h` is the land's height there and `slope` its steepness.
 */
export function wooded(n, e, h, slope) {
  if (h < 4 || onAirfield(BASE, n, e, 400)) return false;
  if (e > PAINT.fieldsEast && h < 60 && slope < 0.12) { const plot = plotAt(n, e); return plot.wood && plot.side > 30; }
  // Thinning out toward the highlands, and none in the glens: they are for flying.
  return h < 420 && slope < 0.3 && noise(n / 700, e / 700, 60) * (0.6 + 0.8 * noise(n / 4000, e / 4000, 61)) > 0.8 + smooth(3000 * SCALE, 7000 * SCALE, n);
}

/** Every post's canopy, in stored steps: the treetops' height over the land, or 0. */
export function canopy(steps) {
  const at = (r, c) => MIN + steps[clamp(r, 0, SIZE - 1) * SIZE + clamp(c, 0, SIZE - 1)] * STEP;
  const out = new Uint8Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const slope = Math.hypot(at(r - 1, c) - at(r + 1, c), at(r, c + 1) - at(r, c - 1)) / (2 * POST);
    if (wooded(NORTH0 - r * POST, EAST0 + c * POST, at(r, c), slope)) out[r * SIZE + c] = TREETOPS / CANOPY_STEP;
  }
  return out;
}

/** Every post's height, row by row from the north-west corner, in stored steps. */
export function build() {
  const steps = new Uint16Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    steps[r * SIZE + c] = clamp(Math.round((shape(NORTH0 - r * POST, EAST0 + c * POST) - MIN) / STEP), 0, 65535);
  }
  return steps;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // One image: the land's height in red and green, the treetops over it in blue.
  const steps = build(), trees = canopy(steps), rgb = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < steps.length; i++) { rgb[i * 3] = steps[i] >> 8; rgb[i * 3 + 1] = steps[i] & 255; rgb[i * 3 + 2] = trees[i]; }
  const here = (name) => fileURLToPath(new URL(name, import.meta.url));
  const png = encodePng(rgb, SIZE, SIZE);
  writeFileSync(here('island.png'), png);
  writeFileSync(here('island.json'), JSON.stringify(region(), null, 2) + '\n');
  let top = 0; for (const s of steps) top = Math.max(top, s);
  console.log(`island.png ${(png.length / 1e6).toFixed(2)} MB; highest point ${Math.round((MIN + top * STEP) / FT)} ft; ${(trees.filter(Boolean).length * POST * POST / 1e6).toFixed(0)} sq km of woods`);
}

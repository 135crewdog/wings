// Shapes the island of docs/island.md and writes its map:
//   node terrain/make-island.mjs
// writes terrain/island.png (the land's height, and the treetops over it),
// terrain/country.png (what kind of country each place is) and
// terrain/island.json (where it all lies, the water and lava, the river, and
// the places landmarks stand), and terrain/landmarks.json (each landmark that
// has a model: where it stands and its solid shapes). Run by hand when the
// island's shape or a landmark's model changes; the app only ever reads the files.
// Metres; north and east of the island's middle.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { encodePng } from './png.mjs';
import { readGlb } from '../models/glb.mjs';
import { solidsOf } from '../models/solids.mjs';
import { onAirfield, plotAt } from '../src/fields.js';

export const SIZE = 1024, POST = 44;                 // posts each way, and metres between them
export const NORTH0 = (SIZE - 1) * POST / 2, EAST0 = -NORTH0;   // the north-west corner
export const MIN = -40, STEP = 0.25;                 // heights are stored in steps of 0.25 m above -40 m
export const TREETOPS = 12, CANOPY_STEP = 0.5;       // a wood stands 12 m (40 ft) tall; treetops are stored in steps of 0.5 m
export const RIVER = 255;                            // in the treetops' place, this marks a post in the river
const RIVER_HALF = 75;                               // m: the river reaches this far either side of its course
export const COUNTRY = 512;                          // country.png is this many pixels each way
const FT = 0.3048;

// ---- the places (docs/island.md, and the owner's sketch in it) ----
export const BASE = { north: -1500, east: 11000, heading: 280, height: 30 * FT };   // the runway's middle; flights take off on 28
const LOCH = { level: 300, half: 620, path: [[10300, -2200], [10750, 300], [10350, 2900], [10650, 5400]] };
export const CASTLE = { north: 9450, east: 2300, height: LOCH.level + 100 };         // the flat top of a crag on the loch's south shore
const GROUNDS = { north: 7500, east: 3500, across: 3300, deep: 1750 };               // the bowl south of the castle: its middle and half-sizes
// The river's course from the loch to the sea, bend by bend. The canyon is cut along it.
const BENDS = [[10250, -2900], [9300, -3700], [7500, -3300], [5400, -4500], [3200, -3500], [1000, -4500], [-1300, -3400], [-3600, -4500],
  [-5800, -3500], [-8000, -4700], [-10000, -6000], [-11900, -5500], [-13600, -6700], [-15400, -7300], [-17300, -8200]];
const CANYON = { floor: 230, rim: 700, lip: 400 };   // half-widths at the river and at the rim; the lip at the loch is this long
// Across the canyon's head, the river under it. Its length lies east and west; its east end is a post of the map
// (see `shape`), which is why it is not a round number.
export const VIADUCT = { north: 9300, east: -3706 };
const VIADUCT_END = 252;    // m: from the viaduct's middle to the outside of its last arch
const VIADUCT_DECK = 120;   // m: its deck above the river
const PLATEAU = 960;                                  // the desert's height along the canyon
const VOLCANO = { north: -8600, east: 1900, rim: 1220, reach: 3500, crater: 520, lake: 330, deep: 250 };
// Where the lava runs from it to the sea: one flow down the west side, fanning out to the coast in three streams.
const FLOW_HEAD = [[-8600, 1900], [-10700, 500], [-12300, -700]];
const FLOWS = [[[-14900, -2700], [-18900, -4700]], [[-15300, -1700], [-19300, -2900]], [[-15000, -500], [-19500, -1100]]].map((mouth) => [...FLOW_HEAD, ...mouth]);
// The redwood forest: the ground inside this line, corner by corner [north, east], south and east of the volcano.
const REDWOODS = [[-11350, -100], [-12200, 3000], [-10900, 6100], [-8300, 6500], [-6100, 8300], [-6500, 12200], [-9150, 12700], [-12200, 10500],
  [-14000, 10700], [-14900, 8300], [-16400, 6500], [-16600, 3900], [-17500, 2100], [-17300, -500], [-12700, -100]];
export const REDWOOD_TOPS = 90;                       // m: about 300 ft
const CONES = [[-6300, 4900, 330, 800], [-10400, -1500, 280, 700], [-11800, 4000, 240, 650]];   // north, east, height, reach
export const STRIP = { north: -4700, east: -11400 };
const COVE = { north: 3900, radius: 900, mouth: 230, inland: 1300 };   // its middle lies this far in from the east coast
const DOOR_NORTH = 1900;
const HIDING_RIDGE = [[3300, -1500], [5800, -100]];   // a ridge in the wall south-west of the castle's grounds
// The mountains: metres north and east, the top's height, and how far the mountain reaches.
const PEAKS = [
  [15200, 600, 2330, 4500], [14400, -4400, 2240, 4300], [14300, 5600, 2160, 4300], [11700, 9700, 2060, 4300], [7600, 10300, 1900, 3900],   // the arc north and east of the loch
  [3900, 7000, 1960, 3500], [3200, 3200, 2110, 3400], [2500, -300, 1830, 3000], [6500, -1000, 1720, 2500],                                   // the wall south and west of the grounds
  [12300, -8000, 2210, 4300], [8300, -8300, 2270, 4300], [4800, -9200, 2120, 3800], [2300, -12600, 1950, 3600],                              // west of the canyon, ending at the crest
  // lower tops between and beyond them, so the whole reads as a range
  [16700, -2000, 1500, 2600], [16400, 3500, 1450, 2500], [13300, 8200, 1400, 2500], [9800, 11800, 1350, 2500], [5600, 9000, 1300, 2400],
  [11000, -5600, 1550, 2500], [6700, -6200, 1400, 2400],
  // the canyon's walls where it runs through the mountains, and the gaps a castle could be seen through
  [8000, -5500, 1850, 2300], [5600, -2400, 1750, 2100], [3900, -5900, 1850, 2300], [4000, -2100, 1650, 2100], [8000, -1700, 1550, 1700], [9600, -5300, 1650, 1900], [3700, 5200, 1550, 2300], [2000, -6000, 1500, 2000], [1500, -1900, 1500, 1900], [15000, -7500, 1450, 2600], [10300, -11200, 1500, 2800], [6200, -12000, 1450, 2700], [1700, -9800, 1500, 2400],
];
// Where the mountains stop, west to east: [east, north] along their southern edge. The first stretch is the crest.
const EDGE = [[-19000, 1200], [-12300, -900], [-7400, 4000], [-4400, 3300], [-2700, -1300], [-300, -1700], [2400, 300], [6200, 2500], [10500, 3600], [14500, 4500], [19000, 5000]];
const CREST_ENDS = -4400;   // east of here the mountains end in foothills, not a wall

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
// Distance from a point to a path of straight legs; how far along the path (0..1) the nearest point is; and which
// side of it the point lies (positive to the right of the way the path runs).
function toPath(path, n, e) {
  let best = Infinity, along = 0, side = 1;
  for (let i = 0; i < path.length - 1; i++) {
    const [an, ae] = path[i], [bn, be] = path[i + 1], dn = bn - an, de = be - ae;
    const t = clamp(((n - an) * dn + (e - ae) * de) / (dn * dn + de * de), 0, 1), d = Math.hypot(n - an - t * dn, e - ae - t * de);
    if (d < best) { best = d; along = (i + t) / (path.length - 1); side = Math.sign(dn * (e - ae) - de * (n - an)) || 1; }
  }
  return [best, along, side];
}
// A path with its corners rounded: a smooth curve through the same points, as many short legs.
function rounded(points, legs = 10) {
  const out = [], at = (i) => points[clamp(i, 0, points.length - 1)];
  for (let i = 0; i < points.length - 1; i++) {
    const [a, b, c, d] = [at(i - 1), at(i), at(i + 1), at(i + 2)];
    for (let k = 0; k < legs; k++) {
      const t = k / legs, t2 = t * t, t3 = t2 * t;
      out.push([0, 1].map((x) => 0.5 * (2 * b[x] + (c[x] - a[x]) * t + (2 * a[x] - 5 * b[x] + 4 * c[x] - d[x]) * t2 + (3 * b[x] - a[x] - 3 * c[x] + d[x]) * t3)));
    }
  }
  out.push(points[points.length - 1]);
  return out;
}
const COURSE = rounded(BENDS);
// Where the lava runs: each flow's course from the crater to the sea, its corners rounded.
export const FLOW_COURSES = FLOWS.map((flow) => rounded(flow, 3).map(([n, e]) => [Math.round(n), Math.round(e)]));
const FLOW_HALF = 45;   // m: running lava reaches this far either side of its course
// The river as the app needs it: fewer legs, each a few hundred metres.
export const RIVER_COURSE = rounded(BENDS, 4).map(([n, e]) => [Math.round(n), Math.round(e)]);

// ---- the coast: how far inland a point is (negative out at sea) ----
const coastRadius = (bearing) => 17600 * (1 + 0.035 * Math.cos(2 * bearing + 0.6) + 0.03 * Math.cos(3 * bearing - 1.1) + 0.02 * Math.cos(5 * bearing + 2));
function inland(n, e) {
  const beach = smooth(-2000, -9000, e) * smooth(4000, -2000, n);   // the south-west shore runs smoother, for its beaches
  let d = coastRadius(Math.atan2(e, n)) - Math.hypot(n, e) + (1 - 0.3 * beach) * (1100 * fbm(n / 5200, e / 5200, 4, 40) + 350 * fbm(n / 1400, e / 1400, 3, 50));
  d += 900 * Math.exp(-(((n - DOOR_NORTH) / 420) ** 2)) * smooth(12000, 16000, e);   // the Door's headland
  return d;
}

// How far north of the mountains' edge a point lies (negative to the south of it), and whether that stretch is the crest.
function intoMountains(n0, e0) {
  const n = n0 + 420 * fbm(n0 / 1700, e0 / 1700, 3, 74), e = e0 + 420 * fbm(n0 / 1700, e0 / 1700, 3, 75);   // the edge wanders
  let best = Infinity, sign = 1, crest = false;
  for (let i = 0; i < EDGE.length - 1; i++) {
    const [ae, an] = EDGE[i], [be, bn] = EDGE[i + 1], de = be - ae, dn = bn - an;
    const t = clamp(((e - ae) * de + (n - an) * dn) / (de * de + dn * dn), 0, 1), d = Math.hypot(e - ae - t * de, n - an - t * dn);
    if (d < best) { best = d; sign = Math.sign(de * (n - an) - dn * (e - ae)) || 1; crest = ae + t * de < CREST_ENDS; }
  }
  return [best * sign, crest];
}

// The cove and the Door stand on the east coast, wherever the coast falls at their latitudes.
const eastCoast = (n) => { let e = 12000; while (inland(n, e) > 0) e += 20; return e; };
COVE.east = eastCoast(COVE.north) - COVE.inland;
export const DOOR = { north: DOOR_NORTH, east: eastCoast(DOOR_NORTH) - 60 };

/** How far inside the redwoods' line a place is: 1 well inside, 0 outside, easing over `ramp` metres from its wandering edge. */
export function redwoods(n0, e0, ramp = 250) {
  const n = n0 + 350 * fbm(n0 / 1300, e0 / 1300, 3, 77), e = e0 + 350 * fbm(n0 / 1300, e0 / 1300, 3, 78);
  let inside = false, edge = Infinity;
  for (let i = 0, j = REDWOODS.length - 1; i < REDWOODS.length; j = i++) {
    const [an, ae] = REDWOODS[i], [bn, be] = REDWOODS[j];
    if ((an > n) !== (bn > n) && e < ae + ((be - ae) * (n - an)) / (bn - an)) inside = !inside;
    edge = Math.min(edge, toPath([REDWOODS[i], REDWOODS[j]], n, e)[0]);
  }
  return inside ? smooth(0, ramp, edge) : 0;
}

/** What kind of country a place is: how much desert, lava and farmland (each 0..1); the rest is green. */
export function country(n0, e0) {
  // Borders wander: every edge below is drawn on a map that has been pushed about a little.
  const n = n0 + 700 * fbm(n0 / 2800, e0 / 2800, 3, 71), e = e0 + 700 * fbm(n0 / 2800, e0 / 2800, 3, 72);
  const [dC, , side] = toPath(COURSE, n0, e0), [north, crest] = intoMountains(n0, e0), d = inland(n0, e0);
  const south = smooth(crest ? 1700 : 1800, crest ? -200 : -1200, north);   // 1 south of the mountains; the desert climbs a little way into them
  const west = side > 0 ? 1 : 1 - smooth(2600, 4600, dC + 500 * fbm(n0 / 1500, e0 / 1500, 2, 73));   // the river runs south, so its right is the west
  let lava = smooth(VOLCANO.reach * 1.05, VOLCANO.reach * 0.85, Math.hypot(n - VOLCANO.north, e - VOLCANO.east));
  // The flow: narrow where it leaves the volcano, a fan a mile and a half wide at the sea.
  const [dF, aF] = toPath(FLOW_COURSES[1], n0, e0), reach = 650 + 1500 * smooth(0.25, 1, aF);
  lava = Math.max(lava, smooth(reach + 350, reach, dF + 200 * fbm(n0 / 900, e0 / 900, 2, 76)));
  for (const [cn, ce, , reach] of CONES) lava = Math.max(lava, smooth(reach * 1.3, reach * 0.9, Math.hypot(n - cn, e - ce)));
  const desert = south * west * (1 - lava) * (side > 0 ? 1 : smooth(-15500, -12500, n));   // east of the river the desert gives way to forest country in the south
  const open = smooth(3500, 6000, e) * smooth(-13500, -11500, n) * south * (1 - lava) * (1 - desert) * smooth(0, 500, d);   // farmland, were there no forest
  return { desert, lava, farm: open * (1 - redwoods(n0, e0)), open };
}

// The loch's box: its path, and room for its shores.
const around = (i) => LOCH.path.map((p) => p[i]), ROOM = LOCH.half + 500;
const lochBox = { south: Math.min(...around(0)) - ROOM, north: Math.max(...around(0)) + ROOM, west: Math.min(...around(1)) - ROOM, east: Math.max(...around(1)) + ROOM };
const lavaLevel = VOLCANO.rim - VOLCANO.deep + 30;
const lavaBox = { south: VOLCANO.north - VOLCANO.crater, north: VOLCANO.north + VOLCANO.crater, west: VOLCANO.east - VOLCANO.crater, east: VOLCANO.east + VOLCANO.crater };

/** The land's height at a point (metres north and east), before it is stored. */
export function shape(n, e) {
  let h = natural(n, e);
  if (h <= 0) return h;
  // The viaduct's east end. The west end runs into the canyon's wall; in the east the ground is only half as high as
  // the deck, which would stop in mid-air. So a hill stands there for it to run into: the river's flat floor as far
  // as the last arch, one post on (the map's steepest slope, hidden inside the viaduct's end wall) a top just above the
  // track, held for a post more, and then a long slope down to the ground by the loch.
  const x = e - VIADUCT.east, off = Math.abs(n - VIADUCT.north + 35), top = VIADUCT_DECK + 10;
  if (x > VIADUCT_END && x < 640 && off < 100) {
    const rise = x < VIADUCT_END + POST ? (top * (x - VIADUCT_END)) / POST : top - 0.3 * Math.max(0, x - VIADUCT_END - 2 * POST);
    h = Math.max(h, viaductBed() + rise * smooth(100, 40, off));
  }
  // Room to fly out. The viaduct stands on a bend, and upstream of it the canyon's west wall crossed straight in
  // front of the western arches, a second's flying away. It is cut back to a low terrace for 650 m north of them;
  // beyond that it rises again, steeply.
  const up = n - VIADUCT.north, out = Math.hypot(Math.max(-400 - x, x - 60, 0), Math.max(60 - up, up - 650, 0));
  if (out < 120) h = Math.min(h, viaductBed() + 8 + 4 * out);
  // The lava's channels. Lava only runs downhill: each stream's bed starts just below the lake's surface and never
  // rises again on its way to the sea. Where the land stands in its way it is cut through. That is a deep breach
  // in the crater's west rim, which is how the lava gets out, and a shallow channel wherever a rise crosses its path.
  for (const run of channels()) {
    let best = Infinity, bed = 0;
    for (let i = 0; i < run.length - 1; i++) {
      const a = run[i], b = run[i + 1], dn = b.n - a.n, de = b.e - a.e;
      const t = clamp(((n - a.n) * dn + (e - a.e) * de) / (dn * dn + de * de), 0, 1), dist = Math.hypot(n - a.n - t * dn, e - a.e - t * de);
      if (dist < best) { best = dist; bed = a.bed + (b.bed - a.bed) * t; }
    }
    if (best < FLOW_HALF * 6 && h > bed) h = bed + (h - bed) * smooth(FLOW_HALF * 2.4, FLOW_HALF * 6, best);   // a flat bed wider than the map's posts are apart, then banks
  }
  return h;
}

// Each stream as a run of points 40 m apart from the lake's edge to the sea, each with the height of the stream's
// bed there: the natural ground, or lower, so that it only ever goes down. Worked out once.
let runs = null;
function channels() {
  if (runs) return runs;
  runs = FLOW_COURSES.map((course) => {
    const run = [];
    let bed = lavaLevel - 2;
    for (let i = 0; i < course.length - 1; i++) {
      const [an, ae] = course[i], [bn, be] = course[i + 1], leg = Math.hypot(bn - an, be - ae);
      for (let d = 0; d < leg; d += 40) {
        const n = an + ((bn - an) * d) / leg, e = ae + ((be - ae) * d) / leg;
        if (Math.hypot(n - VOLCANO.north, e - VOLCANO.east) < VOLCANO.lake) continue;   // still in the lake
        const ground = natural(n, e);
        if (ground <= 0) return run;                                                     // the sea
        bed = Math.min(ground, bed - 0.16);                                              // always a little downhill
        run.push({ n, e, bed });
      }
    }
    return run;
  });
  return runs;
}

/** The land as it would lie with no lava channels cut in it. */
let bed = null;
/** The river's level under the middle of the viaduct. */
function viaductBed() { return (bed ??= Math.round(natural(VIADUCT.north, VIADUCT.east) / STEP) * STEP); }

function natural(n, e) {
  const d = inland(n, e);
  if (d < -2500) return MIN;
  const [north, crest] = intoMountains(n, e);
  const high = smooth(crest ? -700 : -1500, crest ? 2800 : 3800, north) * smooth(0, 1500, d);
  const { desert, lava, farm, open } = country(n, e);
  const [dC, aC, side] = toPath(COURSE, n, e);

  // Lowlands: low rolling hills, but for the farmland and the forest floor.
  // How level the low ground is: the farmland nearly flat, and the redwoods' ground gentle, easing in from their
  // edge so no bank stands at the tree line. (Farmland stops being farmland where the trees start; the ground doesn't.)
  const level = Math.max(open, 0.8 * redwoods(n, e, 900));
  let h = 8 + Math.min(d * 0.004, 30) * (1 - level) + 3 * fbm(n / 1250, e / 1250, 3, 11);
  h += (1 - level) * (1 - desert) * smooth(300, 2500, d) * (70 + 70 * fbm(n / 3500, e / 3500, 4, 12));
  const low = h;   // the land as it would be with no plateau, volcano or mountains on it

  // The desert: a plateau highest along the canyon, falling away west to the beaches and east in a scarp; mesas on it.
  const table = side > 0 ? PLATEAU - (PLATEAU - 230) * smooth(1600, 9500, dC) : PLATEAU - (PLATEAU - 260) * smooth(1900, 4300, dC);
  const mesas = 110 * smooth(0.66, 0.7, noise(n / 1900, e / 1900, 80)) + 60 * smooth(0.72, 0.75, noise(n / 900, e / 900, 81));
  // West of the river the plateau carries on north under the mountains' feet, so the two meet with no trough
  // between: the plateau leads up to the mountains, and the mountains slope down onto it.
  const south = side > 0 ? smooth(5200, 3000, north) : smooth(1800, -1200, north);
  const shelf = south * smooth(0, 1300, d) * (side > 0 ? 1 : (1 - smooth(4300, 5200, dC)) * smooth(-14500, -11500, n));
  h += shelf * (table - h + mesas * desert + 25 * fbm(n / 2600, e / 2600, 3, 82));
  // Along the canyon the plateau holds its height wherever the river runs, mountains or not, so the canyon has its walls.
  const brink = smooth(2700, 1500, dC) * smooth(9300, 7900, n) * smooth(0, 1300, d);
  h = Math.max(h, brink * (PLATEAU + 130 * smooth(1500, 5500, n) + 25 * fbm(n / 2600, e / 2600, 3, 82)));   // a little higher upstream, where the river is higher too

  // The volcano and its cones: broad, with a crater in the top.
  const rv = Math.hypot(n - VOLCANO.north, e - VOLCANO.east);
  const rimR = VOLCANO.crater / VOLCANO.reach, peak = VOLCANO.rim / Math.pow(1 - rimR, 1.25);
  if (rv < VOLCANO.reach) {
    let cone = peak * Math.pow(1 - rv / VOLCANO.reach, 1.25) * (0.94 + 0.12 * noise(n / 900, e / 900, 83));
    if (rv < VOLCANO.crater) cone = VOLCANO.rim - VOLCANO.deep * smooth(VOLCANO.crater, VOLCANO.lake, rv);
    h = Math.max(h, cone);
  }
  for (const [cn, ce, top, reach] of CONES) {
    const r = Math.hypot(n - cn, e - ce) / reach;
    if (r < 1) h += r < 0.18 ? top * 0.72 : top * Math.pow(1 - r, 1.1);
  }

  // The mountains: big ones placed by hand, with ridges and corries cut into them and glens between.
  const wn = n + 1100 * fbm(n / 3600, e / 3600, 3, 20), we = e + 1100 * fbm(n / 3600, e / 3600, 3, 21);
  let massif = 0;
  for (const [pn, pe, top, reach] of PEAKS) {
    const t = Math.hypot(wn - pn, we - pe) / (reach * (0.8 + 0.4 * noise(wn / 2200, we / 2200, 26)));
    if (t < 1) massif += ((top - 330) * Math.pow(1 - t, 1.6) * (0.72 + 0.56 * ridged(wn / 2600, we / 2600, 4, 22))) ** 3;
  }
  h = Math.max(h, low + high * (230 + 110 * fbm(n / 1800, e / 1800, 3, 27) + Math.cbrt(massif)));   // they stand on the low land, not on the plateau
  // The castle's tallest spire stands 220 m above its shelf, and from a few places on the plateau its tips showed over a
  // low stretch of the wall south-west of the grounds. A ridge closes it.
  const [ridgeA, ridgeB] = HIDING_RIDGE, rn = ridgeB[0] - ridgeA[0], re = ridgeB[1] - ridgeA[1];
  const rt = clamp(((n - ridgeA[0]) * rn + (e - ridgeA[1]) * re) / (rn * rn + re * re), 0, 1);
  h = Math.max(h, 1080 - 0.8 * Math.hypot(n - ridgeA[0] - rt * rn, e - ridgeA[1] - rt * re));

  // The grounds: a wide bowl south of the loch, walled in by the mountains round it.
  const bowl = Math.hypot((n - GROUNDS.north) / GROUNDS.deep, (e - GROUNDS.east) / GROUNDS.across);
  const lawn = LOCH.level + 30 + 45 * smooth(0, 1, bowl) + 14 * fbm(n / 900, e / 900, 3, 28);
  if (h > lawn) h = lawn + (h - lawn) * smooth(1, 1.75, bowl);

  // The canyon: cut down to the river along its whole course, in steps like strata, wherever the land stands above it.
  const riverBed = aC < 0.035 ? LOCH.level + 4 : (LOCH.level - 55) * (1 - smooth(0.035, 1, aC) ** 0.85) - 3 * smooth(0.9, 1, aC);   // a lip at the loch, a fall, then down to the sea
  if (dC < CANYON.rim * 1.6 && h > riverBed) {
    const out = clamp((dC - CANYON.floor) / (CANYON.rim - CANYON.floor), 0, 1.6);
    const steps = (Math.floor(out * 5) + smooth(0.55, 1, out * 5 % 1)) / 5;                    // five benches from river to rim
    const wall = riverBed + (PLATEAU * 1.05 + 450 * high - riverBed) * steps + 30 * fbm(n / 500, e / 500, 2, 30) * out;   // the walls stand taller where the canyon runs through the mountains
    if (h > wall) h = dC < CANYON.floor ? riverBed + 2 * fbm(n / 300, e / 300, 2, 31) : wall;
  }

  // The loch, with ground standing above its water all round, and a lip where the river leaves it.
  const [ld] = toPath(LOCH.path, n, e);
  if (h > LOCH.level - 20) h = LOCH.level - 20 + (h - LOCH.level + 20) * smooth(LOCH.half, LOCH.half + 1300, ld);
  if (ld > LOCH.half + 250 && n > lochBox.south - POST && n < lochBox.north + POST && e > lochBox.west - POST && e < lochBox.east + POST) h = Math.max(h, LOCH.level + 4);
  // The castle's shelf on the south shore.
  const shelfR = Math.hypot(n - CASTLE.north, e - CASTLE.east);
  if (shelfR < 400) h = h + (CASTLE.height - h) * smooth(400, 245, shelfR);   // flat under the castle, then the crag's sides

  // The base: dead flat, easing into the fields round it.
  const a = (BASE.heading * Math.PI) / 180, bn = n - BASE.north, be = e - BASE.east;
  const along = Math.abs(bn * Math.cos(a) + be * Math.sin(a)), across = Math.abs(-bn * Math.sin(a) + be * Math.cos(a));
  h += (1 - smooth(0, 1200, Math.max(along - 2200, across - 900))) * (BASE.height - h);

  // The cove's country: chalk downs that end at the sea in cliffs, with the round bay cut into them.
  const fromCove = Math.hypot(n - COVE.north, e - COVE.east);
  h += smooth(4200, 1500, fromCove) * (95 + 30 * fbm(n / 1500, e / 1500, 3, 14)) * smooth(0, 60, d);
  // The shore: land runs down to the water, and the seabed falls away. Cliffs stand where the chalk and the plateau meet the sea.
  if (d < 0) return Math.max(MIN, d * 0.03);
  const cliffs = Math.max(smooth(4200, 2500, fromCove), shelf * smooth(4000, 1500, dC));
  h *= cliffs + (1 - cliffs) * (smooth(0, 300 + 1300 * desert, d) * 0.92 + 0.08);
  h = Math.max(h, 0.6);
  const mouth = Math.abs(n - COVE.north) < COVE.mouth && e > COVE.east;
  if (fromCove < COVE.radius + 160 || mouth) h = Math.min(h, mouth ? -6 : -6 + Math.max(0, fromCove - COVE.radius) * 0.9);
  return h;
}

/**
 * How tall the trees stand over a post, or 0: in the farmland, a wood is one of the plots (src/fields.js marks
 * them), kept back from the plot's edge; the redwoods fill their own ground, uneven on top. None on the airfield,
 * the lava or the shore. `h` is the land's height there and `slope` its steepness.
 */
export function wooded(n, e, h, slope) {
  if (h < 4 || onAirfield(BASE, n, e, 400)) return 0;
  const kind = country(n, e);
  if (redwoods(n, e) > 0.5 && kind.lava < 0.3 && slope < 0.6) return REDWOOD_TOPS - 12 * noise(n / 260, e / 260, 79);
  if (kind.farm > 0.5 && h < 60 && slope < 0.12) { const plot = plotAt(n, e); return plot.wood && plot.side > 30 ? TREETOPS : 0; }
  return 0;
}

/** Every post's blue channel: the treetops' height over the land in stored steps, 0 for open ground, or RIVER. */
export function canopy(steps) {
  const at = (r, c) => MIN + steps[clamp(r, 0, SIZE - 1) * SIZE + clamp(c, 0, SIZE - 1)] * STEP;
  const out = new Uint8Array(SIZE * SIZE);
  for (let r = 0; r < SIZE; r++) for (let c = 0; c < SIZE; c++) {
    const slope = Math.hypot(at(r - 1, c) - at(r + 1, c), at(r, c + 1) - at(r, c - 1)) / (2 * POST);
    const n = NORTH0 - r * POST, e = EAST0 + c * POST;
    const trees = wooded(n, e, at(r, c), slope);
    if (trees) out[r * SIZE + c] = Math.round(trees / CANOPY_STEP);
    else if (at(r, c) > 0 && toPath(COURSE, n, e)[0] < RIVER_HALF && toPath(LOCH.path, n, e)[0] > LOCH.half + 250) out[r * SIZE + c] = RIVER;   // the river, from the loch's lip to the sea
  }
  return out;
}

export const region = () => ({
  image: 'island.png', country: 'country.png', size: SIZE, post: POST, north0: NORTH0, east0: EAST0, min: MIN, step: STEP, seabed: MIN, canopyStep: CANOPY_STEP,
  // Level pools: the loch, and the lava lake in the volcano's crater. Inside its box, anything below a pool's level is under it.
  lochs: [{ level: LOCH.level, kind: 'water', ...lochBox }, { level: lavaLevel, kind: 'lava', ...lavaBox }],
  // The river's course from the loch to the sea. The map itself marks which posts are in it.
  river: RIVER_COURSE,
  // Running lava: each flow's course from the crater to the sea, and how far it reaches either side.
  flows: FLOW_COURSES, flowHalf: FLOW_HALF,
  // Where things stand: metres north and east, and height above sea level.
  sites: { base: BASE, castle: CASTLE, viaduct: { ...VIADUCT, height: viaductBed() }, volcano: { north: VOLCANO.north, east: VOLCANO.east, rim: VOLCANO.rim }, strip: STRIP, cove: { north: COVE.north, east: COVE.east, radius: COVE.radius }, door: DOOR },
});

// The landmarks that have a model, each standing on its site. `turn` is degrees clockwise from the way it was built.
const LANDMARKS = { viaduct: { model: 'viaduct.glb', turn: 0 }, castle: { model: 'castle.glb', turn: 0 } };
const mm = (v) => Math.round(v * 1000) / 1000;

/**
 * terrain/landmarks.json: for each landmark, its model, where its origin stands (north, east, up, turn), and its
 * solid shapes as the flight model wants them (src/sim/solids.js): metres north, east and up on the island.
 */
export function landmarks() {
  const sites = region().sites, out = {};
  for (const [name, { model, turn }] of Object.entries(LANDMARKS)) {
    const { north, east, height } = sites[name], cos = Math.cos((turn * Math.PI) / 180), sin = Math.sin((turn * Math.PI) / 180);
    // The model's axes are x east, y up, z south; turned clockwise, seen from above.
    const way = ([x, y, z]) => [-z * cos - x * sin, -z * sin + x * cos, y];
    const solids = solidsOf(readGlb(fileURLToPath(new URL(`../models/${model}`, import.meta.url)))).map((s) => {
      const [n, e, u] = way(s.centre);
      return { name: s.name, centre: [mm(north + n), mm(east + e), mm(height + u)], half: s.half.map(mm), axes: s.axes.map((a) => way(a).map((v) => Math.round(v * 1e6) / 1e6)) };
    });
    out[name] = { model, north, east, up: height, turn, solids };
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

/** country.png's pixels: desert in red, lava in green, farmland in blue, each 0..255. */
export function countryMap() {
  const rgb = new Uint8Array(COUNTRY * COUNTRY * 3), span = (SIZE - 1) * POST;
  for (let r = 0; r < COUNTRY; r++) for (let c = 0; c < COUNTRY; c++) {
    const { desert, lava, farm } = country(NORTH0 - (r / (COUNTRY - 1)) * span, EAST0 + (c / (COUNTRY - 1)) * span);
    rgb.set([Math.round(desert * 255), Math.round(lava * 255), Math.round(farm * 255)], (r * COUNTRY + c) * 3);
  }
  return rgb;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // One image: the land's height in red and green, the treetops over it in blue.
  const steps = build(), trees = canopy(steps), rgb = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < steps.length; i++) { rgb[i * 3] = steps[i] >> 8; rgb[i * 3 + 1] = steps[i] & 255; rgb[i * 3 + 2] = trees[i]; }
  const here = (name) => fileURLToPath(new URL(name, import.meta.url));
  const png = encodePng(rgb, SIZE, SIZE), kinds = encodePng(countryMap(), COUNTRY, COUNTRY);
  writeFileSync(here('island.png'), png);
  writeFileSync(here('country.png'), kinds);
  writeFileSync(here('island.json'), JSON.stringify(region(), null, 2) + '\n');
  writeFileSync(here('landmarks.json'), JSON.stringify(landmarks()) + '\n');
  let top = 0; for (const s of steps) top = Math.max(top, s);
  console.log(`island.png ${(png.length / 1e6).toFixed(2)} MB, country.png ${(kinds.length / 1e6).toFixed(2)} MB; highest point ${Math.round((MIN + top * STEP) / FT)} ft`);
}

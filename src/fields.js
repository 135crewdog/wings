// The farmland's plots: where each field's edges run, and what grows in it.
// Plots have four sides, more or less: the land is cut into long strips of
// uneven width, each strip is cut across at uneven spacings and at its own
// slant, and the whole pattern bends gently, so few plots are true
// rectangles. The picture's paint (src/render/terrain.js) works the same
// plots out on the graphics chip, number for number; this copy is for
// everything else that has to know where they are: the script that plants
// the woods, and the trees along the tracks. No browser code.

/** A number 0..1 that depends only on three whole numbers. The paint's `rand` is the same sum. */
export function rand(i, j, s) {
  let h = (i * 374761393 + j * 668265263 + s * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth noise, -1..1: it bends the field lines the way real ones bend. */
export function bend(x, y, s) {
  const i = Math.floor(x), j = Math.floor(y), u = (x - i) ** 2 * (3 - 2 * (x - i)), v = (y - j) ** 2 * (3 - 2 * (y - j));
  return 2 * ((rand(i, j, s) * (1 - u) + rand(i + 1, j, s) * u) * (1 - v) + (rand(i, j + 1, s) * (1 - u) + rand(i + 1, j + 1, s) * u) * v) - 1;
}

export const STRIP = 520;    // m: a strip's usual width
export const CROPS = 7;      // how many crops there are to choose from

/**
 * The plot at a point (metres north and east): { i, j } name it; `side` is how
 * far inside its nearest edge the point is (m); `wood` says the plot is
 * woodland; `crop` is which crop it grows (0 to CROPS - 1); `rows` is the
 * distance that counts off its crop rows.
 */
export function plotAt(n, e) {
  const u = n * 0.94 + e * 0.34 + 260 * bend(n / 2600, e / 2600, 6), v = -n * 0.34 + e * 0.94 + 260 * bend(n / 2600, e / 2600, 7);
  const edge = (k) => (k + 0.35 * (rand(k, 0, 8) - 0.5)) * STRIP;             // where strip k begins
  let i = Math.floor(u / STRIP);
  if (u < edge(i)) i--; else if (u >= edge(i + 1)) i++;
  const long = 420 + 520 * rand(i, 1, 9), w = v + (rand(i, 2, 9) - 0.5) * 0.5 * (u - edge(i)) + rand(i, 3, 9) * long;   // this strip's plot length and slant
  const cut = (k) => (k + 0.4 * (rand(i, k, 10) - 0.5)) * long;
  let j = Math.floor(w / long);
  if (w < cut(j)) j--; else if (w >= cut(j + 1)) j++;
  return {
    i, j,
    side: Math.min(u - edge(i), edge(i + 1) - u, w - cut(j), cut(j + 1) - w),
    wood: rand(i, j, 3) < 0.07,
    crop: Math.floor(rand(i, j, 5) * CROPS),
    rows: rand(i, j, 4) < 0.5 ? u : w,
  };
}

/**
 * Whether a point lies on the airfield's own ground: a strip along the
 * runway and off its ends, kept as mown grass, with no crops, woods or trees.
 * `base` is the region's base site; `margin` (m) widens the strip.
 */
export function onAirfield(base, n, e, margin = 0) {
  const a = (base.heading * Math.PI) / 180, bn = n - base.north, be = e - base.east;
  return Math.abs(bn * Math.cos(a) + be * Math.sin(a)) < 2100 + margin && Math.abs(-bn * Math.sin(a) + be * Math.cos(a)) < 450 + margin;
}

export const TREE_GRID = 22;   // m: one scenery tree at most in each square this size

/**
 * Whether a tree stands in the square (i, j) of the tree grid, and where:
 * { north, east, height } or null. `island` gives the land; `region` says
 * where the farmland and the airfield are.
 */
export function treeIn(i, j, island, region) {
  if (rand(i, j, 20) > 0.55) return null;
  const north = (i + 0.2 + 0.6 * rand(i, j, 21)) * TREE_GRID, east = (j + 0.2 + 0.6 * rand(i, j, 22)) * TREE_GRID;
  if (east < region.paint.fieldsEast || onAirfield(region.sites.base, north, east, 150)) return null;
  const side = plotAt(north, east).side;
  if (side < 6 || side > 16) return null;                    // beside a track, not on it and not out in the crop
  const h = island.heightAt(north, east);
  if (h < 4 || h > 60 || island.canopyAt(north, east) > 0 || island.waterAt(north, east) !== null) return null;
  return { north, east, height: 9 + 7 * rand(i, j, 23) };
}

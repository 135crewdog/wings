// Pictures of the island for looking at, from the files the app reads:
//   node terrain/preview.mjs <folder>
// writes map.png (from above, north up) and four low views. The paint here is
// a rough guide to the look, not the app's own.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { createIsland, decodeCanopy, decodeCountry, decodeHeights } from '../src/sim/island.js';
import { onAirfield, plotAt } from '../src/fields.js';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const region = JSON.parse(readFileSync(here('island.json')));
const { rgb, width } = decodePng(readFileSync(here(region.image)));
const kinds = decodePng(readFileSync(here(region.country)));
const island = createIsland(region, decodeHeights(rgb, width * width, 3), decodeCanopy(rgb, width * width, 3), decodeCountry(kinds.rgb, kinds.width * kinds.height, 3));
const out = process.argv[2] ?? '.';
const FT = 0.3048, mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, t)));
const SUN = [0.5, -0.55, 0.67];   // from the south-east, high: north, east, up

// The colour of the ground at a point: paint by rule, then light and shade.
function colour(n, e) {
  const h = island.heightAt(n, e), water = island.waterAt(n, e);
  if (island.lavaAt(n, e) !== null) return [255, 120, 20];                                    // the lava lake
  if (water !== null) return h < 0 ? mix([70, 130, 170], [40, 90, 140], -h / 25) : water > h ? [52, 92, 128] : [60, 110, 140];   // sea, loch, river
  const s = 60, top = (a, b) => island.heightAt(a, b) + island.canopyAt(a, b), dn = (top(n + s, e) - top(n - s, e)) / (2 * s), de = (top(n, e + s) - top(n, e - s)) / (2 * s);
  const slope = Math.hypot(dn, de), len = Math.hypot(dn, de, 1), light = 0.68 + 0.5 * Math.max(0, (-dn * SUN[0] - de * SUN[1] + SUN[2]) / len);
  const { sites } = region, { desert, lava, farm } = island.countryAt(n, e);
  let c = [112, 150, 82];                                             // grass
  if (farm > 0.5 && h < 60 && slope < 0.12 && !onAirfield(sites.base, n, e)) c = field(n, e);
  c = mix(c, [128, 118, 88], (h - 150) / 500);                        // moor
  c = mix(c, [120, 116, 112], Math.max((h - 1100) / 700, (slope - 0.45) / 0.3));   // rock
  const band = Math.floor(h / 55) % 2 ? [196, 120, 78] : [214, 150, 96];
  c = mix(c, mix([222, 184, 132], band, (slope - 0.12) / 0.2), desert);             // desert: tan flats, banded red rock on the slopes
  c = mix(c, mix([38, 36, 38], [70, 52, 46], (slope - 0.2) / 0.5), lava);           // lava: black, rust on the steeps
  const cv = sites.cove;
  if (Math.hypot(n - cv.north, e - cv.east) < 5000 && slope > 0.5 && h < 160) c = [232, 230, 220];   // chalk cliffs
  if (h < 3 + 9 * desert) c = mix([232, 216, 172], c, (h - 1.5 - 5 * desert) / 3);          // sand
  if (island.canopyAt(n, e) > 1) c = [44, 84, 44];                    // woods
  const a = (sites.base.heading * Math.PI) / 180, rn = n - sites.base.north, re = e - sites.base.east;
  if (Math.abs(rn * Math.cos(a) + re * Math.sin(a)) < 1402 && Math.abs(-rn * Math.sin(a) + re * Math.cos(a)) < 23) c = [70, 72, 76];   // the runway
  return c.map((v) => v * light);
}
// Farmland: each plot one flat colour with faint crop rows, a track between plots, and some plots woodland.
const CROPS = [[96, 150, 70], [122, 168, 78], [150, 172, 84], [176, 178, 96], [140, 124, 76], [84, 136, 66], [164, 150, 88]];
function field(n, e) {
  const plot = plotAt(n, e);
  if (plot.side < 4.5) return [168, 140, 96];
  if (plot.wood) return [52, 92, 48];
  return CROPS[plot.crop].map((c) => c * (Math.sin(plot.rows * 1.3) > 0 ? 1 : 0.95));
}
const save = (name, pixels, w, h) => writeFileSync(`${out}/${name}`, encodePng(Uint8Array.from(pixels, (v) => Math.min(255, v)), w, h));

// From above.
{
  const N = 1024, span = (region.size - 1) * region.post, px = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) px.push(...colour(region.north0 - (r / (N - 1)) * span, region.east0 + (c / (N - 1)) * span));
  for (const s of Object.values(region.sites)) {   // a red dot on each place
    const r = Math.round(((region.north0 - s.north) / span) * (N - 1)), c = Math.round(((s.east - region.east0) / span) * (N - 1));
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) px.splice(((r + i) * N + c + j) * 3, 3, 220, 30, 30);
  }
  save('map.png', px, N, N);
}

// A view from `eye` (north, east, feet above sea level) looking along `heading`, `down` degrees below level.
function view(name, north, east, feet, heading, down = 4, W = 960, H = 440) {
  const px = [], fov = (55 * Math.PI) / 180, f = H / 2 / Math.tan(fov / 2), psi = (heading * Math.PI) / 180, th = (-down * Math.PI) / 180;
  const up0 = feet * FT;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    // the ray, in camera axes then turned to the world
    const cx = (x - W / 2) / f, cy = (H / 2 - y) / f, len = Math.hypot(cx, cy, 1);
    const fwd = (Math.cos(th) - cy * Math.sin(th)) / len, upv = (Math.sin(th) + cy * Math.cos(th)) / len, right = cx / len;
    const dn = fwd * Math.cos(psi) - right * Math.sin(psi), de = fwd * Math.sin(psi) + right * Math.cos(psi);
    let t = 30, hit = null;
    while (t < 60000) {
      const n = north + dn * t, e = east + de * t, u = up0 + upv * t, g = Math.max(island.heightAt(n, e) + island.canopyAt(n, e), island.waterAt(n, e) ?? -1e9, island.lavaAt(n, e) ?? -1e9);
      if (u < g) { hit = [n, e, t]; break; }
      t += Math.max(15, (u - g) * 0.4, t * 0.004);
    }
    const sky = mix([207, 230, 247], [70, 130, 210], Math.max(0, upv) * 2.2);
    px.push(...(hit ? mix(colour(hit[0], hit[1]), [207, 230, 247], (hit[2] - 3000) / 24000) : sky));
  }
  save(name, px, W, H);
}
const { base, castle, viaduct, cove, volcano, strip, door } = region.sites;
view('view-base.png', base.north - 600, base.east + 4500, 1500, 280);                    // on final for 28
view('view-fields.png', base.north - 5000, base.east + 1500, 900, 335, 6);               // low over the fields, the mountains ahead
view('view-loch.png', castle.north + 900, castle.east - 5200, 1900, 100, 6);             // along the loch, the castle's shelf on the right shore
view('view-grounds.png', castle.north + 1500, castle.east + 400, 3600, 185, 22);         // from over the loch, south across the castle and its grounds
view('view-canyon-head.png', 6800, -3350, 2100, 350, 4);                                 // up the canyon toward the viaduct's place and the loch
view('view-canyon.png', -9000, -5500, 1700, 35, 2);                                      // in the canyon, flying upstream
view('view-canyon-above.png', -6500, -9500, 9000, 70, 30);                               // the canyon from above the desert
view('view-crest.png', -3000, -13500, 2500, 20, 0);                                      // the crest from over the desert
view('view-strip.png', strip.north - 3500, strip.east + 500, 1800, 350, 6);              // the Strip's place, the crest behind
view('view-volcano.png', volcano.north - 5200, volcano.east + 2500, 5500, 335, 14);      // the volcano from the south-east
view('view-crater.png', volcano.north - 900, volcano.east - 700, 5200, 40, 40);          // into the crater
view('view-cove.png', cove.north - 300, cove.east + 4200, 900, 275, 5);                  // the cove from the sea
view('view-beach.png', -9500, -16800, 600, 20, 3);                                       // the south-west beaches

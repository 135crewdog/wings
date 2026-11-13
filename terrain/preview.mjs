// Pictures of the island for looking at, from the files the app reads:
//   node terrain/preview.mjs <folder>
// writes map.png (from above, north up) and four low views. The paint here is
// a rough guide to the look, not the app's own.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { decodePng, encodePng } from './png.mjs';
import { createIsland, decodeCanopy, decodeHeights } from '../src/sim/island.js';
import { onAirfield, plotAt } from '../src/fields.js';

const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const region = JSON.parse(readFileSync(here('island.json')));
const { rgb, width } = decodePng(readFileSync(here(region.image)));
const island = createIsland(region, decodeHeights(rgb, width * width, 3), decodeCanopy(rgb, width * width, 3));
const out = process.argv[2] ?? '.';
const FT = 0.3048, mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.min(1, Math.max(0, t)));
const SUN = [0.5, -0.55, 0.67];   // from the south-east, high: north, east, up

// The colour of the ground at a point: paint by rule, then light and shade.
function colour(n, e) {
  const h = island.heightAt(n, e), water = island.waterAt(n, e);
  if (water !== null) return water > 0 ? [52, 92, 128] : mix([70, 130, 170], [40, 90, 140], -h / 25);
  const s = 60, top = (a, b) => island.heightAt(a, b) + island.canopyAt(a, b), dn = (top(n + s, e) - top(n - s, e)) / (2 * s), de = (top(n, e + s) - top(n, e - s)) / (2 * s);
  const slope = Math.hypot(dn, de), len = Math.hypot(dn, de, 1), light = 0.68 + 0.5 * Math.max(0, (-dn * SUN[0] - de * SUN[1] + SUN[2]) / len);
  const { sites } = region;
  let c = [112, 150, 82];                                             // grass
  if (e > region.paint.fieldsEast && h < 60 && slope < 0.12) c = field(n, e);          // fields
  c = mix(c, [128, 118, 88], (h - 150) / 500);                        // moor
  c = mix(c, [120, 116, 112], Math.max((h - 1100) / 700, (slope - 0.45) / 0.3));   // rock
  if (n < region.paint.chalkSouth && slope > 0.5) c = [232, 230, 220];                 // chalk cliffs
  if (h < 3) c = mix([214, 200, 160], c, h / 3);                      // sand
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
      const n = north + dn * t, e = east + de * t, u = up0 + upv * t, g = Math.max(island.heightAt(n, e) + island.canopyAt(n, e), island.waterAt(n, e) ?? -1e9);
      if (u < g) { hit = [n, e, t]; break; }
      t += Math.max(15, (u - g) * 0.4, t * 0.004);
    }
    const sky = mix([207, 230, 247], [70, 130, 210], Math.max(0, upv) * 2.2);
    px.push(...(hit ? mix(colour(hit[0], hit[1]), [207, 230, 247], (hit[2] - 3000) / 24000) : sky));
  }
  save(name, px, W, H);
}
const { base, castle, viaduct, cove } = region.sites;
view('view-base.png', base.north - 600, base.east + 4500, 1500, 280);                    // on final for 28
view('view-highlands.png', 0, -2000, 3000, 10, 0);                                    // the highlands from the lowlands
view('view-glen.png', 5150, -4450, 1300, 32, 2);                                     // up the glen toward the viaduct's place
view('view-castle.png', castle.north - 750, castle.east - 2800, 1800, 75, 6);           // the bowl, from over the loch's west end
view('view-fields.png', base.north - 5000, base.east + 1500, 900, 335, 6);                 // low over the fields, the highlands ahead
view('view-coast.png', cove.north - 1500, cove.east + 3500, 800, 285, 3);                // the south coast, heading west

// Hawaii's tiles (terrain/hawaii/, written by terrain/make-hawaii.py) against
// docs/hawaii.md: real heights, 15 km channels, level runways, the sea. Read
// headless, with the same sampler the flight model uses (src/sim/hawaii.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { createHawaii, toWorld, HNL_VORTAC } from '../src/sim/hawaii.js';
import { dir, index, sheet, tiles, tileAt, hawaii } from './tiles.js';

const FT = 0.3048;

// The script's flat map for each group of islands, to find real places in the game's world.
const where = (group, lat, lon) => toWorld(index, group, lat, lon);
// The highest ground within `reach` metres of a place.
const highest = ([north, east], reach = 1500) => {
  let top = -Infinity;
  for (let dn = -reach; dn <= reach; dn += 10) for (let de = -reach; de <= reach; de += 10) top = Math.max(top, hawaii.heightAt(north + dn, east + de));
  return top;
};

test('every sheet the index names is there, the bytes it says', () => {
  let bytes = 0;
  for (const [name, s] of Object.entries(index.sheets)) {
    const data = sheet(name);
    assert.equal(data.length, s.bytes, `${name} is ${s.bytes} bytes`);
    assert.equal(createHash('sha256').update(data).digest('hex').slice(0, 16), s.sha256, `${name} is the one the index means`);
    bytes += data.length;
  }
  assert.equal(bytes, index.bytes);
  const json = statSync(dir + 'index.json').size;
  console.log(`  ${Object.keys(index.sheets).length} sheets, ${index.tiles.length} tiles over ${index.levels} levels: ${(bytes / 1e6).toFixed(1)} MB to download, and the index ${(json / 1e3).toFixed(0)} KB`);
  assert.ok(bytes < 320e6, 'about 300 MB at most, as the owner agreed');
});

test('the summits are their real heights', () => {
  const peaks = [
    ['Mauna Kea', 'hawaii', 19.8207, -155.4681, 13803],
    ['Mauna Loa', 'hawaii', 19.4756, -155.6054, 13679],
    ['Haleakala', 'mauinui', 20.7097, -156.2533, 10023],
    ['Kawaikini', 'kauai', 22.0587, -159.4973, 5243],
    ['Kaala', 'oahu', 21.5086, -158.1428, 4025],
  ].filter(([, group]) => index.groups[group] && [...tiles.keys()].length);
  for (const [name, group, lat, lon, feet] of peaks) {
    const top = highest(where(group, lat, lon)) / FT;
    console.log(`  ${name}: ${Math.round(top).toLocaleString('en-US')} ft (real: ${feet.toLocaleString('en-US')})`);
    assert.ok(Math.abs(top - feet) <= 100, `${name} is within 100 ft of ${feet}`);
  }
});

test('the summits as the picture draws them: never more than a few pixels short, near or far', () => {
  // The picture's grids, read from src/render/terrain.js itself so the two can't drift apart.
  const source = readFileSync(fileURLToPath(new URL('../src/render/terrain.js', import.meta.url)), 'utf8');
  const N = +source.match(/const N = (\d+);/)[1];
  const EASE_FROM = N / 3, EASE_TO = N / 2 - 4;
  // The ground from one level of the copies only, as the picture reads it (src/render/terrain.js, heightFrom).
  const levels = Array.from({ length: index.levels }, (_, L) => createHawaii(index, (l, i, j) => (l < L ? undefined : tileAt(l, i, j))));
  const reads = (m) => Math.min(Math.max(m - 1, 0), index.levels - 1);
  const at = (l, x, z) => levels[l].heightAt(-z, x);   // three.js axes: x east, z south
  // The top of a peak as drawn by mesh level m, from d metres off: the grid's
  // corners lie every `s` metres; toward the level's edge each eases into the
  // next level's ground, the in-between corners onto its triangles' edges.
  const drawnTop = (m, d, [north, east], reach) => {
    const s = index.post * 2 ** m, l = reads(m), k = reads(m + 1);
    const ease = Math.min(Math.max((d / s - EASE_FROM) / (EASE_TO - EASE_FROM), 0), 1);
    let top = -Infinity;
    for (let a = Math.floor((east - reach) / s); a <= Math.ceil((east + reach) / s); a++) {
      for (let b = Math.floor((-north - reach) / s); b <= Math.ceil((-north + reach) / s); b++) {
        const x = a * s, z = b * s, ox = Math.abs(a % 2), oz = Math.abs(b % 2);
        let h = at(l, x, z);
        if (ease > 0) {
          const [dx, dz] = ox && oz ? [s, -s] : [ox * s, oz * s];
          const coarse = ox || oz ? 0.5 * (at(k, x - dx, z - dz) + at(k, x + dx, z + dz)) : at(k, x, z);
          h += (coarse - h) * ease;
        }
        top = Math.max(top, h);
      }
    }
    return top;
  };
  // The mesh level that draws ground d metres off: the finest that reaches that
  // far (the picture draws as many as reach past the haze, which may be fewer).
  const meshFor = (d) => {
    let m = 0;
    while ((N / 2) * index.post * 2 ** m < d) m++;
    return m;
  };
  const PIXELS_PER_DEGREE = 1179 / 55;   // an iPhone 16's screen, landscape, 55 degrees top to bottom
  const peaks = [
    ['Mauna Kea', 'hawaii', 19.8207, -155.4681],
    ['Haleakala', 'mauinui', 20.7097, -156.2533],
    ['Kawaikini', 'kauai', 22.0587, -159.4973],
    ['Kaala', 'oahu', 21.5086, -158.1428],
    ['Konahuanui', 'oahu', 21.3433, -157.7956],
    ['Puu Kukui', 'mauinui', 20.8906, -156.5867],
  ].filter(([, group]) => index.groups[group]);
  const kms = [2, 3, 5, 8, 12, 16, 20, 25, 30, 40, 50, 60];
  console.log(`  feet short of the real summit, and iPhone pixels, from km off (${N} cells a grid):`);
  console.log(`  ${''.padEnd(11)}${kms.map((k) => `${k} km`.padStart(11)).join('')}`);
  let worst = 0;
  for (const [name, group, lat, lon] of peaks) {
    const place = where(group, lat, lon), reach = 1500;
    const real = highest(place, reach);
    const row = kms.map((km) => {
      const d = km * 1000, short = real - drawnTop(meshFor(d), d, place, reach);
      const px = (Math.atan2(short, d) * 180 / Math.PI) * PIXELS_PER_DEGREE;
      worst = Math.max(worst, px);
      return `${Math.round(short / FT)}/${px.toFixed(1)}`.padStart(11);
    });
    console.log(`  ${name.padEnd(11)}${row.join('')}`);
  }
  assert.ok(worst <= 5, `every summit within 5 pixels of its real height at every distance (worst ${worst.toFixed(1)})`);
});

test('every channel between the groups is 15 km, coast to coast', () => {
  // The land at level 3 (a post every 80 m) as one grid, cut into islands
  // (land joined to land), each island put in its group by where its middle
  // is; then the coastline of each group: land with the sea beside it.
  const level = 3, p = index.post * 8, n = index.tile;
  const keys = [...tiles.keys()].filter((k) => +k.split('/')[0] === level).map((k) => k.split('/').map(Number));
  const iMin = Math.min(...keys.map((k) => k[1])), iMax = Math.max(...keys.map((k) => k[1]));
  const jMin = Math.min(...keys.map((k) => k[2])), jMax = Math.max(...keys.map((k) => k[2]));
  const rows = (iMax - iMin + 1) * n, cols = (jMax - jMin + 1) * n;
  const dry = new Uint8Array(rows * cols);
  for (const [, i, j] of keys) {
    const t = tileAt(level, i, j);
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) dry[((iMax - i) * n + r) * cols + (j - jMin) * n + c] = t.water[r * n + c] ? 0 : 1;
  }
  const at = (k) => [(iMax + 1) * n * p - (Math.floor(k / cols) + 0.5) * p, jMin * n * p + ((k % cols) + 0.5) * p];
  const boxes = { niihau: [21.70, -160.30, 22.10, -159.95], kauai: [21.85, -159.82, 22.26, -159.26], oahu: [21.24, -158.30, 21.73, -157.63], mauinui: [20.47, -157.35, 21.24, -155.96], hawaii: [18.89, -156.08, 20.28, -154.79] };
  const groupOf = ([north, east]) => Object.keys(boxes).find((g) => {
    const [s, w, nn, e] = boxes[g], a = where(g, s, w), b = where(g, nn, e);
    return north >= a[0] && north <= b[0] && east >= a[1] && east <= b[1];
  });
  const seen = new Uint8Array(rows * cols), land = {};
  for (let start = 0; start < dry.length; start++) {
    if (!dry[start] || seen[start]) continue;
    const island = [start], coast = [];
    seen[start] = 1;
    let sn = 0, se = 0;
    for (let q = 0; q < island.length; q++) {
      const k = island[q], r = Math.floor(k / cols), c = k % cols;
      const [north, east] = at(k); sn += north; se += east;
      let shore = false;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const rr = r + dr, cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) { shore = true; continue; }
        const kk = rr * cols + cc;
        if (!dry[kk]) shore = true;
        else if (!seen[kk]) { seen[kk] = 1; island.push(kk); }
      }
      if (shore) coast.push([north, east]);
    }
    const g = groupOf([sn / island.length, se / island.length]);
    if (g && island.length > 3) (land[g] ??= []).push(...coast);
  }
  const gap = (a, b) => {
    let best = Infinity;
    for (const [n1, e1] of land[a]) for (const [n2, e2] of land[b]) { const d = (n1 - n2) ** 2 + (e1 - e2) ** 2; if (d < best) best = d; }
    return Math.sqrt(best);
  };
  for (const [a, b] of [['niihau', 'kauai'], ['kauai', 'oahu'], ['oahu', 'mauinui'], ['mauinui', 'hawaii']]) {
    if (!land[a] || !land[b]) continue;
    const km = gap(a, b) / 1000;
    console.log(`  ${a} to ${b}: ${km.toFixed(1)} km`);
    assert.ok(Math.abs(km - 15) <= 1, `${a} to ${b} is 15 km, give or take 1`);
  }
});

// Along a runway: where a point `f` of the way from its first end to its
// second, `k` metres to the right of its centre line, is.
const on = (way, f, k = 0) => {
  const [a, b] = way.ends, length = Math.hypot(b.north - a.north, b.east - a.east);
  const side = [-(b.east - a.east) / length, (b.north - a.north) / length];
  return [a.north + (b.north - a.north) * f + side[0] * k, a.east + (b.east - a.east) * f + side[1] * k];
};
const nameOf = (way) => `${way.airport} ${way.ends[0].ident}/${way.ends[1].ident}`;

test('every runway is dead flat, dry, and where its ends are', () => {
  for (const way of index.runways) {
    const [a, b] = way.ends, [s0, sn, se] = way.surface, half = way.width / 2 - 1;
    assert.ok(sn === 0 && se === 0 && a.height === s0 && b.height === s0, `${nameOf(way)} is level: one height, end to end`);
    // The ground under it, across its whole width, is the drawn surface's height (the app paints the runway on it).
    let worst = 0;
    for (let f = 0; f <= 1; f += 0.02) {
      for (const k of [-half, 0, half]) worst = Math.max(worst, Math.abs(hawaii.heightAt(...on(way, f, k)) - s0));
      assert.equal(hawaii.surfaceAt(...on(way, f)), 'runway', `${nameOf(way)} is dry along its middle`);
    }
    assert.ok(worst < 0.01, `${nameOf(way)}: the ground under it is the runway's height, edge to edge (off by ${worst.toFixed(3)} m)`);
  }
  console.log(`  ${index.runways.length} runways: ${[...new Set(index.runways.map((w) => w.airport))].join(', ')}`);
  const s = index.start;
  assert.deepEqual([s.airport, s.runway], ['PHNL', '08R'], 'every flight starts on 8R at Honolulu');
  assert.ok(Math.hypot(s.north, s.east) < 0.01, 'at its threshold, the world\'s origin');
  assert.ok(Math.abs(hawaii.heightAt(0, 0) - s.height) < 0.01, 'on the runway\'s surface');
});

// The app paints each runway flat at its height (src/render/world.js), with no
// lift: the drawn ground must be that height right to the paint's edges and
// ends, or it would show through the paint, or the paint would hang over a
// bank. The picture draws the ground as triangles between points up to a
// square's diagonal (14 m) apart, each read from the ground at that point, so
// the ground is checked out to a diagonal past the paint all round.
test('every runway\'s paint lies on its ground, right to its edges and ends', () => {
  const reach = index.post * Math.SQRT2;
  let worst = { off: 0 };
  for (const way of index.runways) {
    const [a, b] = way.ends, length = Math.hypot(b.north - a.north, b.east - a.east), out = reach / length;
    for (let f = -out; f <= 1 + out; f += 0.005) {
      for (const k of [-way.width / 2 - reach, -way.width / 2, way.width / 2, way.width / 2 + reach]) {
        const off = Math.abs(hawaii.heightAt(...on(way, f, k)) - way.surface[0]);
        if (off > worst.off) worst = { off, where: nameOf(way) };
      }
    }
    for (const f of [0, 1, -out, 1 + out]) {
      for (let k = -way.width / 2 - reach; k <= way.width / 2 + reach; k += 1) {
        const off = Math.abs(hawaii.heightAt(...on(way, f, k)) - way.surface[0]);
        if (off > worst.off) worst = { off, where: nameOf(way) };
      }
    }
  }
  console.log(`  the paint's edges and ends: the ground at most ${(worst.off * 100).toFixed(1)} cm off${worst.where ? ` (${worst.where})` : ''}`);
  assert.ok(worst.off < 0.01, `within 1 cm everywhere (${(worst.off * 100).toFixed(1)} cm at ${worst.where})`);
});

// A wheel feels a step, not a slope: neighbouring samples a metre apart along
// the centre line and both main-gear tracks (the F-4C's are 2.7 m either side).
test('every runway is smooth: no step a wheel can feel', () => {
  let worst = { step: 0 };
  for (const way of index.runways) {
    const [a, b] = way.ends, length = Math.hypot(b.north - a.north, b.east - a.east);
    for (const k of [-2.7, 0, 2.7]) {
      let before = hawaii.heightAt(...on(way, 0, k));
      for (let s = 1; s <= length; s++) {
        const here = hawaii.heightAt(...on(way, s / length, k)), step = Math.abs(here - before);
        if (step > worst.step) worst = { step, where: `${nameOf(way)}, ${Math.round(s / 0.3048)} ft from ${a.ident}'s threshold` };
        before = here;
      }
    }
  }
  console.log(`  the biggest step on any runway: ${(worst.step * 100).toFixed(1)} cm${worst.where ? ` (${worst.where})` : ''}`);
  assert.ok(worst.step <= 0.01, `no step over 1 cm (${(worst.step * 100).toFixed(1)} cm at ${worst.where})`);
});

test('the sea is water at sea level, in the channels and beyond the islands', () => {
  for (const [north, east] of [[-5000, 5000], [-3000, 0], [500000, 500000], [-1e6, -1e6]]) {
    assert.equal(hawaii.surfaceAt(north, east), 'water', `${north}, ${east} is the sea`);
    assert.equal(hawaii.heightAt(north, east), 0, 'at sea level');
  }
});

test('water lies level: none stands on a sea cliff, and a lake is still a lake', () => {
  // What the map itself says, post by post: its coastline can sit a post or two up a cliff face.
  const flagged = (north, east) => {
    const R = Math.round(-north / index.post - 0.5), C = Math.round(east / index.post - 0.5);
    const i = -Math.floor(R / index.tile) - 1, j = Math.floor(C / index.tile), t = tileAt(0, i, j);
    return t ? t.water[(R + (i + 1) * index.tile) * index.tile + C - j * index.tile] === 1 : true;
  };
  // Hectares within `reach` of a place that the map calls water, and that the flight model does, standing `feet` or more above the sea.
  const standing = ([north, east], reach, feet) => {
    let map = 0, sim = 0, top = 0;
    for (let n = north - reach + 2.5; n < north + reach; n += 5) {
      for (let e = east - reach + 2.5; e < east + reach; e += 5) {
        if (!flagged(n, e)) continue;
        const h = hawaii.heightAt(n, e);
        if (h < feet * FT) continue;
        map++;
        if (hawaii.surfaceAt(n, e) === 'water') { sim++; top = Math.max(top, h); }
      }
    }
    return { map: map * 25 / 1e4, sim: sim * 25 / 1e4, top: top / FT };
  };
  const cliffs = [
    ['Makapuu Head', where('oahu', 21.3100, -157.6498), 1500],
    ['the Na Pali coast', where('kauai', 22.175, -159.65), 6000],
    ['Molokai\'s north shore', where('mauinui', 21.17, -156.88), 6000],
  ];
  for (const [name, at, reach] of cliffs) {
    const { map, sim, top } = standing(at, reach, 50);
    console.log(`  ${name}: the map has ${map.toFixed(1)} ha of water 50 ft or more up; the flight model ${sim.toFixed(1)} ha${sim ? `, none above ${Math.ceil(top)} ft` : ''}`);
    assert.ok(map > 1, 'the map does put water up this cliff');
    assert.ok(sim < 0.1 * map, `${name}: nearly none of it is water (${sim.toFixed(1)} of ${map.toFixed(1)} ha)`);
  }
  // Lake Wilson at Wahiawa, 800 ft up in a gulch, and Lake Waiau, 13,000 ft up Mauna Kea.
  const wilson = standing(where('oahu', 21.495, -158.045), 2500, 500);
  console.log(`  Lake Wilson: ${wilson.map.toFixed(1)} ha on the map, ${wilson.sim.toFixed(1)} ha in the flight model`);
  assert.ok(wilson.sim > 0.9 * wilson.map, 'Lake Wilson is still a lake');
  assert.equal(hawaii.surfaceAt(...where('hawaii', 19.8113, -155.4775)), 'water', 'Lake Waiau is still a lake');
});

test('the HNL VORTAC stands on the Honolulu airport, near 8R', () => {
  const [north, east] = where(HNL_VORTAC.group, HNL_VORTAC.lat, HNL_VORTAC.lon);
  const fromThreshold = Math.hypot(north, east);
  console.log(`  HNL VORTAC ${Math.round(north)} m north, ${Math.round(east)} m east of 8R's threshold`);
  assert.ok(fromThreshold < 3000, 'within 3 km of the threshold of 8R');
  assert.equal(hawaii.surfaceAt(north, east), 'runway', 'on dry land');
  assert.ok(Math.abs(hawaii.heightAt(north, east) - HNL_VORTAC.feet * FT) < 5, 'at the airport\'s height');
});

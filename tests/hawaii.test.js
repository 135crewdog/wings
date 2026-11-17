// Hawaii's tiles (terrain/hawaii/, written by terrain/make-hawaii.py) against
// docs/hawaii.md: real heights, 15 km channels, level runways, the sea. Read
// headless, with the same sampler the flight model uses (src/sim/hawaii.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { decodePng } from '../terrain/png.mjs';
import { createHawaii, decodeTile } from '../src/sim/hawaii.js';

const dir = fileURLToPath(new URL('../terrain/hawaii/', import.meta.url));
const index = JSON.parse(readFileSync(dir + 'index.json', 'utf8'));
const FT = 0.3048;

// Every tile, decoded as the app decodes it.
const sheets = new Map();
const sheet = (name) => sheets.get(name) ?? sheets.set(name, readFileSync(dir + name)).get(name);
const tiles = new Map();
for (const [level, i, j, name, ho, hl] of index.tiles) tiles.set(`${level}/${i}/${j}`, { name, ho, hl });
const decoded = new Map();
const tileAt = (level, i, j) => {
  const k = `${level}/${i}/${j}`, t = tiles.get(k);
  if (!t) return null;
  if (!decoded.has(k)) decoded.set(k, decodeTile(decodePng(sheet(t.name).subarray(t.ho, t.ho + t.hl)).rgb, index, 3));
  return decoded.get(k);
};
const hawaii = createHawaii(index, tileAt);

// The script's flat map for each group of islands, to find real places in the game's world.
function metresPerDegree(lat) {
  const p = (lat * Math.PI) / 180;
  return [111132.954 - 559.822 * Math.cos(2 * p) + 1.175 * Math.cos(4 * p), 111412.84 * Math.cos(p) - 93.5 * Math.cos(3 * p) + 0.118 * Math.cos(5 * p)];
}
const where = (group, lat, lon) => {
  const g = index.groups[group], [mLat, mLon] = metresPerDegree(g.lat0);
  return [(lat - g.lat0) * mLat + g.origin[0], (lon - g.lon0) * mLon + g.origin[1]];
};
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

test('every runway is level, dry, and where its ends are', () => {
  for (const way of index.runways) {
    const [a, b] = way.ends;
    let worst = 0;
    for (let f = 0; f <= 1; f += 0.02) {
      const north = a.north + (b.north - a.north) * f, east = a.east + (b.east - a.east) * f;
      const want = a.height + (b.height - a.height) * f;
      worst = Math.max(worst, Math.abs(hawaii.heightAt(north, east) - want));
      assert.equal(hawaii.surfaceAt(north, east), 'runway', `${way.airport} ${a.ident}/${b.ident} is dry along its middle`);
    }
    assert.ok(worst < 0.5, `${way.airport} ${a.ident}/${b.ident} is level along its length (off by ${worst.toFixed(2)} m)`);
  }
  console.log(`  ${index.runways.length} runways: ${[...new Set(index.runways.map((w) => w.airport))].join(', ')}`);
  const s = index.start;
  assert.deepEqual([s.airport, s.runway], ['PHNL', '08R'], 'every flight starts on 8R at Honolulu');
  assert.ok(Math.hypot(s.north, s.east) < 0.01, 'at its threshold, the world\'s origin');
  assert.ok(Math.abs(hawaii.heightAt(0, 0) - s.height) < 0.3, 'on the runway\'s surface');
});

test('the sea is water at sea level, in the channels and beyond the islands', () => {
  for (const [north, east] of [[-5000, 5000], [-3000, 0], [500000, 500000], [-1e6, -1e6]]) {
    assert.equal(hawaii.surfaceAt(north, east), 'water', `${north}, ${east} is the sea`);
    assert.equal(hawaii.heightAt(north, east), 0, 'at sea level');
  }
});

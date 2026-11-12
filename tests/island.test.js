// The island's land, read the way the app reads it: from terrain/island.png
// and terrain/island.json. What docs/island.md promises is checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePng } from '../terrain/png.mjs';
import { build, region as freshRegion } from '../terrain/make-island.mjs';
import { createIsland, decodeHeights } from '../src/sim/island.js';

const FT = 0.3048, NM = 1852, DEG = Math.PI / 180;
const region = JSON.parse(readFileSync(new URL('../terrain/island.json', import.meta.url)));
const png = decodePng(readFileSync(new URL(`../terrain/${region.image}`, import.meta.url)));
const heights = decodeHeights(png.rgb, png.width * png.height, 3);
const island = createIsland(region, heights);
const { base, castle, viaduct, cove, door } = region.sites;

test('island: the files are what the script writes today', () => {
  assert.equal(png.width, region.size);
  assert.deepEqual(region, JSON.parse(JSON.stringify(freshRegion())), 'island.json is stale: run node terrain/make-island.mjs');
  assert.deepEqual(heights, build(), 'island.png is stale: run node terrain/make-island.mjs');
});

test('island: about 40 miles across, with open sea all round', () => {
  const span = (region.size - 1) * region.post;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (let n = -span / 2; n <= span / 2; n += 200) for (let e = -span / 2; e <= span / 2; e += 200) {
    if (island.heightAt(n, e) > 0) { west = Math.min(west, e); east = Math.max(east, e); south = Math.min(south, n); north = Math.max(north, n); }
  }
  const across = (east - west) / NM, upDown = (north - south) / NM;
  console.log(`\n  The island: ${across.toFixed(1)} miles east to west, ${upDown.toFixed(1)} north to south`);
  assert.ok(across > 36 && across < 44 && upDown > 36 && upDown < 44, `${across} by ${upDown} miles`);
  for (const [n, e] of [[span / 2, 0], [-span / 2, 0], [0, span / 2], [0, -span / 2], [span, span]]) {
    assert.equal(island.waterAt(n, e), 0, 'the map ends in sea');
  }
});

test('island: the highlands top out between 6,000 and 8,000 feet, in the north', () => {
  let top = 0, where = null;
  for (let r = 0; r < region.size; r++) for (let c = 0; c < region.size; c++) {
    const h = region.min + heights[r * region.size + c] * region.step;
    if (h > top) { top = h; where = region.north0 - r * region.post; }
  }
  console.log(`  Highest peak: ${Math.round(top / FT)} ft, ${(where / NM).toFixed(1)} miles north of the middle`);
  assert.ok(top / FT > 6000 && top / FT < 8000, `${top / FT} ft`);
  assert.ok(where > 8000);
});

test('island: the base is flat along the runway and its overruns, 30 feet up', () => {
  const a = base.heading * DEG;
  for (let along = -1900; along <= 1900; along += 50) for (const across of [-150, 0, 150]) {
    const n = base.north + along * Math.cos(a) - across * Math.sin(a), e = base.east + along * Math.sin(a) + across * Math.cos(a);
    assert.ok(Math.abs(island.heightAt(n, e) - base.height) < 0.3, `${along} m along: ${island.heightAt(n, e)} m`);
    assert.equal(island.waterAt(n, e), null);
  }
  assert.ok(Math.abs(base.height / FT - 30) < 1);
});

test('island: the loch is level, and the castle stands on dry rock above it', () => {
  const loch = region.lochs[0];
  let wet = 0;
  for (let n = loch.south; n <= loch.north; n += 100) for (let e = loch.west; e <= loch.east; e += 100) {
    const level = island.waterAt(n, e);
    if (level !== null) { wet++; assert.equal(level, loch.level); }
  }
  assert.ok(wet > 300, `the loch covers ${wet} hectares`);
  assert.equal(island.waterAt(castle.north, castle.east), null);
  assert.ok(Math.abs(island.heightAt(castle.north, castle.east) - castle.height) < 2);
  assert.ok(castle.height > loch.level + 50);
});

// Whether the top of the castle (100 m above its rock) can be seen from a point.
function seesCastle(n, e, up) {
  const top = castle.height + 100, dist = Math.hypot(castle.north - n, castle.east - e);
  for (let d = 100; d < dist - 300; d += 60) {
    const t = d / dist;
    if (island.heightAt(n + (castle.north - n) * t, e + (castle.east - e) * t) > up + (top - up) * t) return false;
  }
  return true;
}

test('island: the castle is hidden from the base and from 1,000 feet over the lowlands', () => {
  assert.equal(seesCastle(base.north, base.east, base.height + 3), false, 'seen from the runway');
  let seen = 0, looked = 0;
  for (let n = -34000; n <= 5000; n += 1500) for (let e = -34000; e <= 34000; e += 1500) {
    const ground = island.heightAt(n, e);
    if (ground <= 0) continue;
    looked++;
    if (seesCastle(n, e, ground + 1000 * FT)) seen++;
  }
  console.log(`  The castle: seen from ${seen} of ${looked} places 1,000 ft over the lowlands`);
  assert.equal(seen, 0);
});

test('island: the south coast has its cliffs, cove and headland; the viaduct has a glen to span', () => {
  // The cove: water in the middle, cliffs round it, the sea through its mouth.
  assert.equal(island.waterAt(cove.north, cove.east), 0);
  assert.equal(island.waterAt(cove.north - 600, cove.east), 0, 'the mouth is open to the sea');
  for (const bearing of [0, 60, 300]) {
    const n = cove.north + 800 * Math.cos(bearing * DEG), e = cove.east + 800 * Math.sin(bearing * DEG);
    assert.ok(island.heightAt(n, e) > 60, `cliff ${bearing} deg from the cove: ${island.heightAt(n, e)} m`);
  }
  assert.ok(island.heightAt(door.north + 150, door.east) > 5, 'the Door stands on land');
  assert.equal(island.waterAt(door.north - 400, door.east), 0);
  // The glen at the viaduct: a floor with high ground a kilometre either side.
  const floor = island.heightAt(viaduct.north, viaduct.east);
  let sides = 0;
  for (let b = 0; b < 360; b += 30) if (island.heightAt(viaduct.north + 1500 * Math.cos(b * DEG), viaduct.east + 1500 * Math.sin(b * DEG)) > floor + 150) sides++;
  assert.ok(sides >= 4, `${sides} of 12 directions rise from the glen floor`);
});

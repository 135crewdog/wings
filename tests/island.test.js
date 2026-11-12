// The island's land, read the way the app reads it: from terrain/island.png
// and terrain/island.json. What docs/island.md promises is checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePng } from '../terrain/png.mjs';
import { build, region as freshRegion } from '../terrain/make-island.mjs';
import { DRAWN_CELLS_PER_POST, createIsland, decodeHeights } from '../src/sim/island.js';

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

test('island: about 20 miles across, with open sea all round', () => {
  const span = (region.size - 1) * region.post;
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (let n = -span / 2; n <= span / 2; n += 100) for (let e = -span / 2; e <= span / 2; e += 100) {
    if (island.heightAt(n, e) > 0) { west = Math.min(west, e); east = Math.max(east, e); south = Math.min(south, n); north = Math.max(north, n); }
  }
  const across = (east - west) / NM, upDown = (north - south) / NM;
  console.log(`\n  The island: ${across.toFixed(1)} miles east to west, ${upDown.toFixed(1)} north to south`);
  assert.ok(across > 18 && across < 22 && upDown > 18 && upDown < 22, `${across} by ${upDown} miles`);
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
  assert.ok(where > 4000);
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
  for (let n = loch.south; n <= loch.north; n += 50) for (let e = loch.west; e <= loch.east; e += 50) {
    const level = island.waterAt(n, e);
    if (level !== null) { wet++; assert.equal(level, loch.level); }
  }
  assert.ok(wet > 400, `the loch covers ${wet / 4} hectares`);
  // Its shores hold it in: all round the edge of its box the ground is above the water.
  for (let t = 0; t <= 1; t += 0.002) {
    const n = loch.south + t * (loch.north - loch.south), e = loch.west + t * (loch.east - loch.west);
    for (const [pn, pe] of [[n, loch.west], [n, loch.east], [loch.south, e], [loch.north, e]]) {
      assert.ok(island.heightAt(pn, pe) >= loch.level, `the loch spills at ${pn}, ${pe}: ground ${island.heightAt(pn, pe)} m`);
    }
  }
  assert.equal(island.waterAt(castle.north, castle.east), null);
  assert.ok(Math.abs(island.heightAt(castle.north, castle.east) - castle.height) < 2);
  assert.ok(castle.height > loch.level + 50);
});

// Whether the top of the castle (100 m above its rock) can be seen from a point.
function seesCastle(n, e, up) {
  const top = castle.height + 100, dist = Math.hypot(castle.north - n, castle.east - e);
  for (let d = 100; d < dist - 300; d += 40) {
    const t = d / dist;
    if (island.heightAt(n + (castle.north - n) * t, e + (castle.east - e) * t) > up + (top - up) * t) return false;
  }
  return true;
}

test('island: the castle is hidden from the base and from 1,000 feet over the lowlands', () => {
  assert.equal(seesCastle(base.north, base.east, base.height + 3), false, 'seen from the runway');
  let seen = 0, looked = 0;
  for (let n = -19000; n <= 2500; n += 600) for (let e = -19000; e <= 19000; e += 600) {
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
  assert.equal(island.waterAt(cove.north - cove.radius - 150, cove.east), 0, 'the mouth is open to the sea');
  for (const bearing of [0, 60, 300]) {
    const reach = cove.radius + 300, n = cove.north + reach * Math.cos(bearing * DEG), e = cove.east + reach * Math.sin(bearing * DEG);
    assert.ok(island.heightAt(n, e) > 60, `cliff ${bearing} deg from the cove: ${island.heightAt(n, e)} m`);
  }
  assert.ok(island.heightAt(door.north + 100, door.east) > 5, 'the Door stands on land');
  assert.equal(island.waterAt(door.north - 400, door.east), 0);
  // The glen at the viaduct: a floor with high ground half a mile either side.
  const floor = island.heightAt(viaduct.north, viaduct.east);
  let sides = 0;
  for (let b = 0; b < 360; b += 30) if (island.heightAt(viaduct.north + 800 * Math.cos(b * DEG), viaduct.east + 800 * Math.sin(b * DEG)) > floor + 150) sides++;
  assert.ok(sides >= 4, `${sides} of 12 directions rise from the glen floor`);
});

// ---- flying from the island's air base, headless, as the app does ----
import { deriveCard } from '../src/sim/card.js';
import { F4C } from '../src/sim/cards/f4c.js';
import { Sim, DT } from '../src/sim/sim.js';
import { qtoEuler } from '../src/sim/vec.js';
import { PARKED, baseField, startState } from '../src/field.js';
import { islandGround } from '../src/sim/island.js';
import { fly } from './fly.js';
import { circuit } from './circuit.js';

const ground = islandGround(island), field = baseField(region, island);

test('island: the flight model stands on the sea and the loch as it does on land', () => {
  assert.equal(ground.heightAt(-30000, 0), 0, 'the sea, far out');
  assert.equal(ground.heightAt(cove.north, cove.east), 0, 'the cove');
  const loch = region.lochs[0];
  assert.equal(ground.heightAt(castle.north - 500, castle.east), loch.level, 'the loch, off the castle');
  assert.ok(Math.abs(ground.heightAt(base.north, base.east) - base.height) < 0.3, 'the runway');
});

test('island: at the start the jet sits still on the numbers of runway 28, with the runway ahead', () => {
  const card = deriveCard(F4C);
  const sim = new Sim(card, startState(card, field), { ground, gear: true, flaps: true });
  for (let i = 0; i < 5 / DT; i++) sim.step(PARKED);
  const settled = [...sim.state.x];
  for (let i = 0; i < 30 / DT; i++) sim.step(PARKED);
  const moved = Math.hypot(...sim.state.x.map((x, i) => x - settled[i])), euler = qtoEuler(sim.state.q);
  const a = field.heading * DEG, ahead = ((field.north - sim.state.x[0]) * Math.cos(a) + (field.east - sim.state.x[1]) * Math.sin(a) + field.runway.length / 2) / FT;
  console.log(`  On runway 28: heading ${((euler.yaw / DEG + 360) % 360).toFixed(1)}, ${Math.round(ahead)} ft of runway ahead, field ${(field.height / FT).toFixed(0)} ft above the sea; moves ${(moved / FT).toFixed(2)} ft in 30 s`);
  assert.equal(sim.crashed, null);
  assert.ok(moved < 0.3, 'it stays put on the brakes');
  assert.deepEqual(sim.touching.slice(0, 3), [true, true, true], 'all three wheels are on the ground');
  assert.ok(Math.abs(((euler.yaw / DEG + 360) % 360) - 280) < 0.5, 'heading 280');
  assert.ok(Math.abs(euler.pitch) < 0.2 * DEG && Math.abs(euler.roll) < 0.5 * DEG, 'level');
  assert.ok(ahead > 8900 && ahead < 9200, 'nearly all of the 9,200 ft ahead');
});

test('island: a whole flight from the base: take off on 28, fly a circuit, land and stop on the runway', () => {
  const card = deriveCard(F4C);
  const sim = new Sim(card, startState(card, field), { ground, gear: true, flaps: true });
  for (let t = 0; t < 3; t += DT) sim.step(PARKED);
  const pilot = circuit({ field }), released = sim.t;
  const log = fly(sim, 480, pilot, 1);
  const e = pilot.events, half = field.runway.length / 2, edge = field.runway.width / 2;
  assert.equal(sim.crashed, null, 'no crash');
  for (const name of ['liftoff', 'base', 'flare', 'touchdown', 'stopped']) assert.ok(e[name], `the flight reached: ${name}`);
  const along = (m) => Math.round((m + half) / FT);
  console.log(`  From the base: lifts off at ${e.liftoff.kias.toFixed(0)} kt, ${along(e.liftoff.north)} ft down the runway; highest ${Math.round(Math.max(...log.map((r) => r.ft)))} ft`);
  console.log(`  touches down at ${e.touchdown.kias.toFixed(0)} kt, ${along(e.touchdown.north)} ft past the threshold; stops ${along(e.stopped.north)} ft down the runway; the flight took ${((e.stopped.t - released) / 60).toFixed(1)} min`);
  assert.ok(Math.abs(e.liftoff.north) < half, 'it lifts off before the end of the runway');
  for (const name of ['touchdown', 'stopped']) assert.ok(Math.abs(e[name].north) < half && Math.abs(e[name].east) < edge, `${name} is on the runway`);
});

test('island: over the hills the radar altitude and the altitude part company', () => {
  // A mile-high pass north over the range: the ground comes up under the jet and falls away again.
  let least = Infinity, most = 0;
  for (let n = 0; n < 17000; n += 100) {
    const above = 3000 - ground.heightAt(n, castle.east - 4000);
    least = Math.min(least, above); most = Math.max(most, above);
  }
  console.log(`  At 9,840 ft from the lowlands north across the range: the ground is between ${Math.round(least / FT)} and ${Math.round(most / FT)} ft below`);
  assert.ok(most > 2800 && least < 1500 && least > 0);
});

test('island: the ground drawn near the jet is the ground the flight model feels', () => {
  // The finest drawn squares, as src/render/terrain.js lays them: corners on whole cells from the island's
  // middle, each square two triangles split corner to corner. Compare the drawn height with the flight
  // model's everywhere along the south coast's cliffs, where the land is at its sharpest, and in the highlands.
  const cell = region.post / DRAWN_CELLS_PER_POST;
  assert.ok(Number.isInteger(region.north0 / cell) && Number.isInteger(region.east0 / cell), 'the posts lie on the lines of the drawn squares');
  const drawn = (north, east) => {
    const x = east / cell, z = -north / cell, i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const at = (di, dj) => island.heightAt(-(j + dj) * cell, (i + di) * cell);
    // The square's triangles are (a, c, b) and (b, c, d): a at (i, j), b at (i+1, j), c at (i, j+1), d at (i+1, j+1).
    return fx + fz < 1 ? at(0, 0) + fx * (at(1, 0) - at(0, 0)) + fz * (at(0, 1) - at(0, 0)) : at(1, 1) + (1 - fx) * (at(0, 1) - at(1, 1)) + (1 - fz) * (at(1, 0) - at(1, 1));
  };
  let worst = 0;
  const look = (n0, n1, e0, e1) => { for (let n = n0; n < n1; n += 7.3) for (let e = e0; e < e1; e += 7.3) worst = Math.max(worst, Math.abs(drawn(n, e) - island.heightAt(n, e))); };
  look(-18600, -17400, -6000, 2000);                                   // the cliffs, the cove and the Door's headland
  look(castle.north - 1500, castle.north + 1500, castle.east - 1500, castle.east + 1500);
  look(base.north - 600, base.north + 600, base.east - 2000, base.east + 2000);
  console.log(`  Drawn ground against the flight model's, near the jet: at most ${(worst / FT).toFixed(1)} ft apart`);
  assert.ok(worst < 1, `${worst} m apart`);
});

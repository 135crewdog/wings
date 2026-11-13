// The island's land, read the way the app reads it: from terrain/island.png
// and terrain/island.json. What docs/island.md promises is checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePng } from '../terrain/png.mjs';
import { build, canopy as plantWoods, region as freshRegion } from '../terrain/make-island.mjs';
import { DRAWN_CELLS_PER_POST, createIsland, decodeCanopy, decodeHeights } from '../src/sim/island.js';

const FT = 0.3048, NM = 1852, DEG = Math.PI / 180;
const region = JSON.parse(readFileSync(new URL('../terrain/island.json', import.meta.url)));
const png = decodePng(readFileSync(new URL(`../terrain/${region.image}`, import.meta.url)));
const heights = decodeHeights(png.rgb, png.width * png.height, 3);
const woods = decodeCanopy(png.rgb, png.width * png.height, 3);
const island = createIsland(region, heights, woods);
const { base, castle, viaduct, cove, door } = region.sites;

test('island: the files are what the script writes today', () => {
  assert.equal(png.width, region.size);
  assert.deepEqual(region, JSON.parse(JSON.stringify(freshRegion())), 'island.json is stale: run node terrain/make-island.mjs');
  assert.deepEqual(heights, build(), 'island.png is stale: run node terrain/make-island.mjs');
  assert.deepEqual(woods, plantWoods(heights), 'island.png\'s woods are stale: run node terrain/make-island.mjs');
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
const wood = nearestWood();

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
  // `felt` is the surface in question: the dry one (land and treetops), or the whole ground with its water.
  const dry = (n, e) => island.heightAt(n, e) + island.canopyAt(n, e);
  let felt = dry;
  const drawn = (north, east) => {
    const x = east / cell, z = -north / cell, i = Math.floor(x), j = Math.floor(z), fx = x - i, fz = z - j;
    const at = (di, dj) => felt(-(j + dj) * cell, (i + di) * cell);
    // The square's triangles are (a, c, b) and (b, c, d): a at (i, j), b at (i+1, j), c at (i, j+1), d at (i+1, j+1).
    return fx + fz < 1 ? at(0, 0) + fx * (at(1, 0) - at(0, 0)) + fz * (at(0, 1) - at(0, 0)) : at(1, 1) + (1 - fx) * (at(0, 1) - at(1, 1)) + (1 - fz) * (at(1, 0) - at(1, 1));
  };
  let worst = 0;
  const look = (n0, n1, e0, e1) => { for (let n = n0; n < n1; n += 7.3) for (let e = e0; e < e1; e += 7.3) worst = Math.max(worst, Math.abs(drawn(n, e) - felt(n, e))); };
  look(-18600, -17400, -6000, 2000);                                   // the cliffs, the cove and the Door's headland
  look(castle.north - 1500, castle.north + 1500, castle.east - 1500, castle.east + 1500);
  look(base.north - 600, base.north + 600, base.east - 2000, base.east + 2000);
  look(wood.north - 400, wood.north + 400, wood.east - 400, wood.east + 400);          // a wood: its top and its sides
  console.log(`  Drawn ground against the flight model's, near the jet: at most ${(worst / FT).toFixed(1)} ft apart`);
  assert.ok(worst < 1, `${worst} m apart`);
  // The waterline is the one crease that follows no line of the map: where a cliff stands in the sea, the drawn
  // shore and the felt one part by a few feet inside the one square the waterline crosses.
  felt = ground.heightAt; worst = 0;
  look(-18600, -17400, -6000, 2000);
  console.log(`  At the waterline under the cliffs: at most ${(worst / FT).toFixed(1)} ft apart`);
  assert.ok(worst < 3, `${worst} m apart at the waterline`);
});

// ---- hitting things (docs/island.md, "What is solid") ----
import { airborne } from './fly.js';
import { qfromEuler } from '../src/sim/vec.js';

// The jet over the island at a place, `feet` above the sea, flying level on `heading` at `kt`, coming down at `fpm`.
function over(card, { north, east, feet, heading, kt, fpm = 0, pitch = 0, gear = false, crashes = true }) {
  const sim = airborne(card, { ft: feet, kt, pitch, gear, flaps: gear, ground });
  const V = kt * KT, a = heading * DEG;
  sim.state.x = [north, east, -feet * FT];
  sim.state.q = qfromEuler(0, pitch * DEG, a);
  sim.state.v = [V * Math.cos(pitch * DEG), 0, V * Math.sin(pitch * DEG) + ((fpm * FT) / 60) * Math.cos(pitch * DEG)];
  sim.crashes = crashes;
  return sim;
}
const KT = 0.514444;

test('island: with crashes on, flying into a mountain ends the flight; a scrape, a slope landing and the override do not', () => {
  const card = deriveCard(F4C);
  // Level at 400 knots toward the mountain north of the loch, below its top.
  const into = { north: 9000, east: -1500, feet: 4500, heading: 0, kt: 400 };
  const hit = over(card, into);
  fly(hit, 60);
  console.log(`  Into the mountainside at 400 kt: ${hit.crashed ? `${hit.crashed.reason}, closing at ${Math.round(hit.crashed.value / KT)} kt, ${(hit.t).toFixed(0)} s in` : 'no crash'}`);
  assert.equal(hit.crashed?.reason, 'hard impact');
  assert.ok(hit.crashed.value > 50, 'it meets the slope at most of its speed, though it was not sinking at all');
  // The same flight with the crash override on: nothing ends it.
  const spared = over(card, { ...into, crashes: false });
  fly(spared, 60);
  assert.equal(spared.crashed, null, 'with the override on, nothing ends the flight');
  // A landing on a gently rising field, off the runway: 140 knots, 300 ft/min, gear down.
  const meadow = { north: base.north - 2500, east: base.east - 1500 };
  const up = ground.heightAt(meadow.north, meadow.east);
  const land = over(card, { ...meadow, feet: up / FT + 14, heading: 280, kt: 140, fpm: 300, pitch: 8, gear: true });
  fly(land, 20, () => ({ gear: true, flaps: true, brake: true, elevator: 0.2 }));
  console.log(`  A landing in a field at 300 ft/min: ${land.crashed ? land.crashed.reason : 'survives'}`);
  assert.equal(land.crashed, null, 'a gentle arrival on land survives');
});

test('island: with crashes on, any touch of the sea or the loch ends the flight, however gentle', () => {
  const card = deriveCard(F4C);
  const loch = region.lochs[0];
  for (const [name, at] of [['the sea', { north: -22000, east: 0, feet: 12 }], ['the loch', { north: castle.north - 500, east: castle.east, feet: loch.level / FT + 12 }]]) {
    const wet = over(card, { ...at, heading: 90, kt: 150, fpm: 100, pitch: 8 });
    fly(wet, 30);
    console.log(`  Onto ${name} at 100 ft/min: ${wet.crashed ? wet.crashed.reason : 'no crash'}`);
    assert.equal(wet.crashed?.reason, 'water', name);
    const dry = over(card, { ...at, heading: 90, kt: 150, fpm: 100, pitch: 8, crashes: false });
    fly(dry, 30);
    assert.equal(dry.crashed, null, `${name}, with the override on`);
    assert.ok(-dry.state.x[2] > (name === 'the sea' ? 0 : loch.level) - 1, 'and the water holds the jet up');
  }
});

// ---- woods and trees ----
import { onAirfield, treeIn } from '../src/fields.js';

// A wood in the farmland: the nearest one to the base, west of it.
function nearestWood() {
  let best = null;
  for (let r = 0; r < region.size; r++) for (let c = 0; c < region.size; c++) {
    if (!woods[r * region.size + c]) continue;
    const north = region.north0 - r * region.post, east = region.east0 + c * region.post, far = Math.hypot(north - base.north, east - (base.east - 4000));
    if (east > region.paint.fieldsEast && (!best || far < best.far)) best = { north, east, far };
  }
  return best;
}

test('island: woods stand 40 feet tall, cover a modest part of the land, and keep off the airfield and the glens', () => {
  const tall = island.canopyAt(wood.north, wood.east);
  let posts = 0, onField = 0, inGlens = 0, landPosts = 0;
  for (let r = 0; r < region.size; r++) for (let c = 0; c < region.size; c++) {
    const north = region.north0 - r * region.post, east = region.east0 + c * region.post;
    if (region.min + heights[r * region.size + c] * region.step > 0) landPosts++;
    if (!woods[r * region.size + c]) continue;
    posts++;
    if (onAirfield(base, north, east, 300)) onField++;
    if (north > 4500 && (east < region.paint.fieldsEast || region.min + heights[r * region.size + c] * region.step > 60)) inGlens++;   // farmland runs north along the east coast; its woods are not in the glens
  }
  console.log(`  Woods: ${(tall / FT).toFixed(0)} ft tall, ${((100 * posts) / landPosts).toFixed(1)}% of the land`);
  assert.ok(Math.abs(tall / FT - 40) < 1);
  assert.ok(posts / landPosts > 0.02 && posts / landPosts < 0.1);
  assert.equal(onField, 0, 'none on the airfield or off the runway\'s ends');
  assert.equal(inGlens, 0, 'none in the highlands: the glens are for flying');
});

test('island: a wood is solid at its treetops, and the radar altimeter reads to them', () => {
  const card = deriveCard(F4C);
  const floor = island.heightAt(wood.north, wood.east);
  assert.ok(Math.abs(ground.heightAt(wood.north, wood.east) - floor - 12) < 0.5, 'the ground the flight model feels is the treetops');
  // Trimmed and level at 250 knots, heading north at the wood from 500 m south of its southern edge, over open field.
  let edge = wood.north;
  while (island.canopyAt(edge, wood.east) > 0) edge -= region.post;
  for (let n = edge - 500; n <= edge; n += 20) assert.equal(island.canopyAt(n, wood.east), 0, 'the run-in is open ground');
  const pass = (feetUp) => {
    const sim = airborne(card, { ft: floor / FT + feetUp, kt: 250, level: true, throttle: 'trim', ground });
    sim.state.x = [edge - 500, wood.east, sim.state.x[2]];
    fly(sim, 6, () => ({ elevator: sim.trim.elevator, throttle: sim.trim.throttle }));
    return sim;
  };
  const into = pass(25), clear = pass(120);
  console.log(`  Into a wood at 250 kt, 25 ft up: ${into.crashed ? `${into.crashed.reason} at the ${into.crashed.point}, closing at ${Math.round(into.crashed.value / KT)} kt` : 'no crash'}; 120 ft up: ${clear.crashed ? 'crash' : 'clear'}`);
  assert.equal(into.crashed?.reason, 'hard impact');
  assert.equal(clear.crashed, null, 'over the top is clear');
});

test('island: scenery trees stand beside the tracks, never on the airfield, the water or a wood, and not too many at once', () => {
  let most = 0, total = 0;
  for (const [north, east] of [[base.north, base.east], [base.north - 4000, base.east - 3000], [wood.north, wood.east], [-9000, 9000]]) {
    let count = 0;
    for (let i = Math.round((north - 1400) / 22); i <= (north + 1400) / 22; i++) for (let j = Math.round((east - 1400) / 22); j <= (east + 1400) / 22; j++) {
      const tree = treeIn(i, j, island, region);
      if (!tree) continue;
      count++;
      assert.equal(onAirfield(base, tree.north, tree.east, 100), false, 'a tree on the airfield');
      assert.equal(island.waterAt(tree.north, tree.east), null);
      assert.equal(island.canopyAt(tree.north, tree.east), 0);
      assert.ok(tree.height > 8 && tree.height < 17);
    }
    most = Math.max(most, count); total += count;
  }
  console.log(`  Trees round the camera: up to ${most} at once`);
  assert.ok(total > 400 && most < 2500, `${most} trees at once`);
});

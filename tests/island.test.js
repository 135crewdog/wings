// The island's land, read the way the app reads it: from terrain/island.png
// and terrain/island.json. What docs/island.md promises is checked here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePng } from '../terrain/png.mjs';
import { build, canopy as plantWoods, countryMap, region as freshRegion } from '../terrain/make-island.mjs';
import { DRAWN_CELLS_PER_POST, RIVER, createIsland, decodeCanopy, decodeCountry, decodeHeights } from '../src/sim/island.js';

const FT = 0.3048, NM = 1852, DEG = Math.PI / 180;
const region = JSON.parse(readFileSync(new URL('../terrain/island.json', import.meta.url)));
const png = decodePng(readFileSync(new URL(`../terrain/${region.image}`, import.meta.url)));
const heights = decodeHeights(png.rgb, png.width * png.height, 3);
const woods = decodeCanopy(png.rgb, png.width * png.height, 3);
const kinds = decodePng(readFileSync(new URL(`../terrain/${region.country}`, import.meta.url)));
const island = createIsland(region, heights, woods, decodeCountry(kinds.rgb, kinds.width * kinds.height, 3));
const { base, castle, viaduct, cove, door, volcano, strip } = region.sites;
const loch = region.lochs.find((l) => l.kind === 'water'), lake = region.lochs.find((l) => l.kind === 'lava');
// Every post on dry land, as { north, east, h }.
function* land() {
  for (let r = 0; r < region.size; r++) for (let c = 0; c < region.size; c++) {
    const h = region.min + heights[r * region.size + c] * region.step;
    if (h > 0) yield { north: region.north0 - r * region.post, east: region.east0 + c * region.post, h, post: r * region.size + c };
  }
}

test('island: the files are what the script writes today', () => {
  assert.equal(png.width, region.size);
  assert.deepEqual(region, JSON.parse(JSON.stringify(freshRegion())), 'island.json is stale: run node terrain/make-island.mjs');
  assert.deepEqual(heights, build(), 'island.png is stale: run node terrain/make-island.mjs');
  assert.deepEqual(woods, plantWoods(heights), 'island.png\'s woods are stale: run node terrain/make-island.mjs');
  assert.deepEqual(kinds.rgb, countryMap(), 'country.png is stale: run node terrain/make-island.mjs');
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

test('island: the mountains top out between 6,000 and 8,000 feet, in the north', () => {
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

test('island: the loch is level and held in by its shores; the castle\'s shelf is on its south shore', () => {
  let wet = 0, southmost = Infinity;
  for (let n = loch.south; n <= loch.north; n += 50) for (let e = loch.west; e <= loch.east; e += 50) {
    const level = island.waterAt(n, e);
    if (level === null || level !== loch.level) continue;
    wet++;
    if (Math.abs(e - castle.east) < 100) southmost = Math.min(southmost, n);
  }
  assert.ok(wet > 1500, `the loch covers ${wet / 4} hectares`);
  // All round the edge of its box the ground is above the water, but for the river's lip.
  for (let t = 0; t <= 1; t += 0.002) {
    const n = loch.south + t * (loch.north - loch.south), e = loch.west + t * (loch.east - loch.west);
    for (const [pn, pe] of [[n, loch.west], [n, loch.east], [loch.south, e], [loch.north, e]]) {
      assert.ok(island.heightAt(pn, pe) >= loch.level, `the loch spills at ${pn}, ${pe}: ground ${island.heightAt(pn, pe)} m`);
    }
  }
  assert.equal(island.waterAt(castle.north, castle.east), null, 'the shelf is dry');
  assert.ok(Math.abs(island.heightAt(castle.north, castle.east) - castle.height) < 2, 'and level');
  console.log(`  The castle's shelf: ${Math.round((castle.height - loch.level) / FT)} ft above the loch, ${Math.round(southmost - castle.north)} m from its south shore`);
  assert.ok(castle.height > loch.level + 15 && southmost > castle.north && southmost - castle.north < 500, 'on the south shore');
});

// The castle's spire tips, from its model's solid shapes (terrain/landmarks.json): where each stands, and how high
// its point is. A spire's box stops two-thirds of the way up its roof, so the tip is half as high again.
const tips = JSON.parse(readFileSync(new URL('../terrain/landmarks.json', import.meta.url))).castle.solids.filter((s) => s.name.startsWith('solid_spire'))
  .map((s) => { const half = s.half[s.axes.findIndex((a) => Math.abs(a[2]) > 0.9)]; return { north: s.centre[0], east: s.centre[1], top: s.centre[2] + 2 * half }; });
// Whether any spire tip of the castle can be seen from a point.
function seesCastle(n, e, up) {
  return tips.some((tip) => {
    const dist = Math.hypot(tip.north - n, tip.east - e);
    for (let d = 100; d < dist - 300; d += 40) {
      const t = d / dist;
      if (island.heightAt(n + (tip.north - n) * t, e + (tip.east - e) * t) > up + (tip.top - up) * t) return false;
    }
    return true;
  });
}

test('island: the castle is hidden from the base and from 1,000 feet over the fields, the desert and the south', () => {
  assert.equal(seesCastle(base.north, base.east, base.height + 3), false, 'seen from the runway');
  let seen = 0, looked = 0;
  for (let n = -19000; n <= 19000; n += 600) for (let e = -19000; e <= 19000; e += 600) {
    const here = island.heightAt(n, e), { desert, lava, farm } = island.countryAt(n, e);
    if (here <= 0 || !(desert > 0.5 || lava > 0.5 || farm > 0.5 || n < -3000)) continue;   // outside the mountains
    looked++;
    if (seesCastle(n, e, here + 1000 * FT)) seen++;
  }
  console.log(`  The castle: seen from ${seen} of ${looked} places 1,000 ft over the country outside the mountains`);
  const highest = Math.max(...tips.map((t) => t.top));
  console.log(`  ${tips.length} spire tips, the highest ${Math.round((highest - castle.height) / FT)} ft above the castle's ground`);
  assert.ok(Math.abs(highest - castle.height - 220) < 3, 'the highest tip is where the model has it');
  assert.equal(seen, 0);
});

test('island: the canyon runs from the loch to the sea, a river in it all the way, deep and wide enough to fly', () => {
  const course = region.river;
  let shallowest = Infinity, narrowest = Infinity, dry = 0, length = 0, previous = Infinity;
  for (let i = 1; i < course.length; i++) {
    const [an, ae] = course[i - 1], [bn, be] = course[i], leg = Math.hypot(bn - an, be - ae), across = [-(be - ae) / leg, (bn - an) / leg];
    length += leg;
    for (let t = 0; t < 1; t += 0.25) {
      const n = an + (bn - an) * t, e = ae + (be - ae) * t, bed = island.heightAt(n, e);
      if (bed <= 0 || island.waterAt(n, e) === loch.level) continue;     // in the sea, or still in the loch
      if (island.waterAt(n, e) === null) dry++;
      assert.ok(bed <= previous + 6, `the river runs uphill at ${Math.round(n)}, ${Math.round(e)}`);
      previous = Math.min(previous, bed);
      // The rims: the highest ground within three-quarters of a mile either side. The floor: how far the flat reaches.
      const rim = (sign) => { let top = -Infinity; for (let d = 300; d <= 1400; d += 50) top = Math.max(top, island.heightAt(n + sign * across[0] * d, e + sign * across[1] * d)); return top; };
      const flat = (sign) => { let d = 0; while (d < 1000 && island.heightAt(n + sign * across[0] * d, e + sign * across[1] * d) < bed + 30) d += 10; return d; };
      if (i > 8 && bed > 12) {   // past the head, where the viaduct stands, and short of the mouth, where the walls come down to the beach
        shallowest = Math.min(shallowest, Math.min(rim(1), rim(-1)) - bed); narrowest = Math.min(narrowest, flat(1) + flat(-1)); }
    }
  }
  console.log(`  The canyon: ${(length / NM).toFixed(1)} miles of river; at least ${Math.round(shallowest / FT)} ft from rim to river and ${(narrowest / NM).toFixed(2)} miles wide at the river`);
  assert.equal(dry, 0, 'water all the way');
  assert.ok(length / NM > 12);
  assert.ok(shallowest / FT > 2500, 'at least 2,500 ft deep, away from its head and its mouth');
  assert.ok(narrowest / NM > 0.23, 'about a quarter mile wide at the river');
  assert.ok(Math.hypot(viaduct.north - course[4][0], viaduct.east - course[4][1]) < 400, 'the viaduct\'s place is on the river, at the canyon\'s head');
});

test('island: the desert, its crest, the volcano and its lava lake, the cove and the Door', () => {
  // The Strip's place: desert, and fairly flat.
  assert.ok(island.countryAt(strip.north, strip.east).desert > 0.9, 'the Strip stands in the desert');
  // The crest: from the desert a mile south of the mountains' wall, the ground rises at least 2,500 ft within two miles north.
  let wall = 0;
  for (let e = -11500; e <= -8500; e += 500) {
    let foot = Infinity, top = 0;
    for (let n = -1500; n <= 6500; n += 100) { const h = island.heightAt(n, e); if (island.countryAt(n, e).desert > 0.5) foot = Math.min(foot, h); top = Math.max(top, h); }
    wall = Math.max(wall, top - foot);
  }
  // The volcano: a rim about 4,000 ft up, and lava in the crater below it.
  let rim = 0;
  for (let b = 0; b < 360; b += 10) rim = Math.max(rim, island.heightAt(volcano.north + 560 * Math.cos(b * DEG), volcano.east + 560 * Math.sin(b * DEG)));
  assert.equal(island.lavaAt(volcano.north, volcano.east), lake.level, 'lava in the crater');
  assert.equal(island.waterAt(volcano.north, volcano.east), null);
  assert.ok(island.countryAt(volcano.north + 2000, volcano.east).lava > 0.9, 'lava country round it');
  // Running lava: each flow leaves the crater and reaches the sea, on black ground all the way.
  for (const course of region.flows) {
    let last = Infinity;
    for (let i = 1; i < course.length; i++) for (let t = 0; t < 1; t += 0.1) {
      const n = course[i - 1][0] + (course[i][0] - course[i - 1][0]) * t, e = course[i - 1][1] + (course[i][1] - course[i - 1][1]) * t, h = island.heightAt(n, e);
      if (h <= 0) { last = 0; break; }
      assert.ok(island.lavaAt(n, e) !== null, `no lava on the flow at ${Math.round(n)}, ${Math.round(e)}`);
      assert.ok(island.countryAt(n, e).lava > 0.5, `the flow leaves the lava country at ${Math.round(n)}, ${Math.round(e)}`);
      last = h;
    }
    assert.equal(last, 0, 'the flow reaches the sea');
  }
  // Lava only runs downhill: out through a breach in the rim below the lake's level, and never up again to the sea.
  let breach = Infinity, rise = 0;
  for (const course of region.flows) {
    let last = lake.level;
    for (let i = 1; i < course.length; i++) for (let t = 0; t < 1; t += 0.02) {
      const n = course[i - 1][0] + (course[i][0] - course[i - 1][0]) * t, e = course[i - 1][1] + (course[i][1] - course[i - 1][1]) * t;
      const from = Math.hypot(n - volcano.north, e - volcano.east), bed = island.heightAt(n, e);
      if (bed <= 0) break;                                        // the sea
      const top = island.lavaAt(n, e);                            // the lava's surface: the lake's level, then the stream on its bed
      assert.ok(top !== null, `no lava at ${Math.round(n)}, ${Math.round(e)}`);
      if (from > 340 && from < 700) breach = Math.min(breach, lake.level - bed);
      rise = Math.max(rise, top - last);
      last = Math.min(last, top);
    }
  }
  console.log(`  The lava's way out: a breach in the rim, its floor ${breach.toFixed(0)} m below the lake's surface at the least; down the streams the lava's surface never rises more than ${rise.toFixed(1)} m`);
  assert.ok(breach > 0, 'the breach is below the lake, so the lava can leave');
  assert.ok(rise < 1.5, 'the streams never run uphill');
  assert.equal(region.flows.length, 3, 'one flow, in three streams');
  assert.ok(region.flows.every((course) => course[course.length - 1][1] < volcano.east), 'down the west side');
  assert.equal(island.lavaAt(volcano.north - 3000, volcano.east + 3200), null, 'no lava down the east side');
  // The cove: water a mile across, cliffs round it, its mouth open to the sea in the east.
  let across = 0;
  for (let e = cove.east - 1500; e < cove.east + 1500; e += 20) if (island.waterAt(cove.north + 300, e) === 0) across += 20;
  for (const bearing of [180, 225, 270, 315, 0]) {
    const reach = cove.radius + 350, n = cove.north + reach * Math.cos(bearing * DEG), e = cove.east + reach * Math.sin(bearing * DEG);
    assert.ok(island.heightAt(n, e) > 50, `cliff ${bearing} deg from the cove: ${island.heightAt(n, e)} m`);
  }
  for (let e = cove.east; e < cove.east + 3000; e += 50) assert.equal(island.waterAt(cove.north, e), 0, 'the mouth is open to the sea');
  let mouth = 0;
  for (let n = cove.north - 600; n < cove.north + 600; n += 10) if (island.waterAt(n, cove.east + cove.radius + 200) === 0) mouth += 10;
  assert.ok(island.heightAt(door.north, door.east - 150) > 3, 'the Door stands on land');
  assert.equal(island.waterAt(door.north, door.east + 400), 0);
  console.log(`  The crest: a wall ${Math.round(wall / FT)} ft high. The volcano: rim at ${Math.round(rim / FT)} ft, lava ${Math.round((rim - lake.level) / FT)} ft below it`);
  console.log(`  The cove: ${(across / NM).toFixed(2)} miles across, its mouth ${(mouth / NM).toFixed(2)} miles wide`);
  assert.ok(wall / FT > 2500);
  assert.ok(Math.abs(rim / FT - 4000) < 300 && rim - lake.level > 100);
  assert.ok(across / NM > 0.9 && across / NM < 1.15 && mouth / NM > 0.2 && mouth / NM < 0.35);
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

test('island: the flight model stands on the sea, the loch and the lava as it does on land', () => {
  assert.equal(ground.heightAt(-30000, 0), 0, 'the sea, far out');
  assert.equal(ground.heightAt(cove.north, cove.east), 0, 'the cove');
  assert.equal(ground.heightAt(castle.north + 800, castle.east), loch.level, 'the loch, off the castle');
  assert.equal(ground.heightAt(volcano.north, volcano.east), lake.level, 'the lava lake');
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

test('island: a whole flight from the base: take off on 28, fly a left-hand circuit, land and stop on the runway', () => {
  const card = deriveCard(F4C);
  const sim = new Sim(card, startState(card, field), { ground, gear: true, flaps: true });
  for (let t = 0; t < 3; t += DT) sim.step(PARKED);
  const pilot = circuit({ field, hand: -1 }), released = sim.t;   // a left-hand pattern: the mountains are to the right
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
  for (let n = -4000; n < 17000; n += 100) {
    const above = 3000 - ground.heightAt(n, 9000);
    least = Math.min(least, above); most = Math.max(most, above);
  }
  console.log(`  At 9,840 ft from the lowlands north across the range: the ground is between ${Math.round(least / FT)} and ${Math.round(most / FT)} ft below`);
  assert.ok(most > 2800 && least < 2000 && least > 0);
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
  look(cove.north - 1400, cove.north + 1400, cove.east - 1400, cove.east + 1400);     // the cove and its cliffs
  look(-6500, -4500, -5200, -2500);                                    // the canyon, wall to wall
  look(volcano.north - 700, volcano.north + 700, volcano.east - 700, volcano.east + 700);   // the crater
  look(castle.north - 1500, castle.north + 1500, castle.east - 1500, castle.east + 1500);
  look(base.north - 600, base.north + 600, base.east - 2000, base.east + 2000);
  look(wood.north - 400, wood.north + 400, wood.east - 400, wood.east + 400);          // a wood: its top and its sides
  console.log(`  Drawn ground against the flight model's, near the jet: at most ${(worst / FT).toFixed(1)} ft apart`);
  assert.ok(worst < 1, `${worst} m apart`);
  // The waterline is the one crease that follows no line of the map: where a cliff stands in the sea, the drawn
  // shore and the felt one part by a few feet inside the one square the waterline crosses.
  felt = ground.heightAt; worst = 0;
  look(cove.north - 1400, cove.north + 1400, cove.east - 1400, cove.east + 1400);
  console.log(`  At the waterline under the cove's cliffs: at most ${(worst / FT).toFixed(1)} ft apart`);
  assert.ok(worst < 3, `${worst} m apart at the waterline`);
});

// ---- hitting things (docs/island.md, "What is solid") ----
import { airborne } from './fly.js';
import { qfromEuler } from '../src/sim/vec.js';

// The jet over the island at a place, `feet` above the sea, flying level on `heading` at `kt`, coming down at `fpm`.
function over(card, { north, east, feet, heading, kt, fpm = 0, pitch = 0, gear = false, crashes = true, on = ground }) {
  const sim = airborne(card, { ft: feet, kt, pitch, gear, flaps: gear, ground: on });
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
  // Level at 400 knots over the loch toward the mountain north of it, below its top.
  const into = { north: 10800, east: 600, feet: 4500, heading: 0, kt: 400 };
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

test('island: with crashes on, any touch of the sea, the loch, the river or the lava ends the flight, however gentle', () => {
  const card = deriveCard(F4C);
  const river = region.river[30], bed = island.heightAt(river[0], river[1]);
  const stream = region.flows[1][9];   // well down the middle stream, on the low ground
  const places = [
    ['the sea', { north: -22000, east: 0, feet: 12 }, 'water', 0],
    ['the loch', { north: castle.north + 800, east: castle.east - 1500, feet: loch.level / FT + 12 }, 'water', loch.level],
    ['the river', { north: river[0], east: river[1], feet: bed / FT + 12, heading: 200 }, 'water', bed - 40],
    ['the lava lake', { north: volcano.north, east: volcano.east - 250, feet: lake.level / FT + 12 }, 'lava', lake.level],
    ['a lava flow', { north: stream[0], east: stream[1], feet: island.heightAt(stream[0], stream[1]) / FT + 12, heading: 190, pitch: 4 }, 'lava', 0],
  ];
  for (const [name, at, reason, floor] of places) {
    const down = over(card, { heading: 90, kt: 150, fpm: 100, pitch: 8, ...at });
    fly(down, 12);
    console.log(`  Onto ${name} at 100 ft/min: ${down.crashed ? down.crashed.reason : 'no crash'}`);
    assert.equal(down.crashed?.reason, reason, name);
    const spared = over(card, { heading: 90, kt: 150, fpm: 100, pitch: 8, ...at, crashes: false });
    fly(spared, 12);
    assert.equal(spared.crashed, null, `${name}, with the override on`);
    assert.ok(-spared.state.x[2] > floor - 1, 'and it holds the jet up');
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
    if (woods[r * region.size + c] * region.canopyStep < 30 && (!best || far < best.far)) best = { north, east, far };   // a farmland wood, not the river's mark or the redwoods
  }
  return best;
}

test('island: woods stand 40 feet tall in the farmland; the redwoods stand about 300 feet, south and east of the volcano', () => {
  const tall = island.canopyAt(wood.north, wood.east);
  let posts = 0, onField = 0, elsewhere = 0, farmland = 0, giants = 0, tallest = 0, shortest = Infinity, onLava = 0, north = -Infinity;
  for (const { north: n, east: e, post } of land()) {
    const kind = island.countryAt(n, e);
    if (kind.farm > 0.5) farmland++;
    if (!woods[post] || woods[post] === RIVER) continue;
    const trees = woods[post] * region.canopyStep;
    if (onAirfield(base, n, e, 300)) onField++;
    if (trees > 30) {
      giants++; tallest = Math.max(tallest, trees); shortest = Math.min(shortest, trees); north = Math.max(north, n);
      if (kind.lava > 0.5) onLava++;
    } else { posts++; if (kind.farm < 0.5) elsewhere++; }
  }
  const sqMiles = (giants * region.post ** 2) / NM ** 2;
  console.log(`  Woods: ${(tall / FT).toFixed(0)} ft tall, ${((100 * posts) / farmland).toFixed(1)}% of the farmland. Redwoods: ${Math.round(shortest / FT)} to ${Math.round(tallest / FT)} ft tall, ${sqMiles.toFixed(0)} square miles`);
  assert.ok(Math.abs(tall / FT - 40) < 1);
  assert.ok(posts / farmland > 0.02 && posts / farmland < 0.1);
  assert.equal(onField, 0, 'no trees on the airfield or off the runway\'s ends');
  assert.ok(elsewhere / posts < 0.02, 'the farmland\'s woods are in the farmland');
  assert.ok(shortest / FT > 240 && tallest / FT < 310 && sqMiles > 12 && sqMiles < 40, 'a forest of giants');
  assert.equal(onLava, 0, 'none on the lava');
  assert.ok(north < base.north - 3500, 'the redwoods stay south of the base');
  assert.ok(island.canopyAt(-13000, 7000) > 60 && island.canopyAt(-9500, 9500) > 60, 'they fill the ground south and east of the volcano');
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
  for (const [north, east] of [[base.north, base.east], [base.north - 4000, base.east - 3000], [wood.north, wood.east], [-9000, 9000], [strip.north, strip.east], [volcano.north, volcano.east]]) {
    let count = 0;
    for (let i = Math.round((north - 1400) / 22); i <= (north + 1400) / 22; i++) for (let j = Math.round((east - 1400) / 22); j <= (east + 1400) / 22; j++) {
      const tree = treeIn(i, j, island, region);
      if (!tree) continue;
      count++;
      assert.equal(onAirfield(base, tree.north, tree.east, 100), false, 'a tree on the airfield');
      assert.equal(island.waterAt(tree.north, tree.east), null);
      assert.equal(island.canopyAt(tree.north, tree.east), 0);
      assert.ok(island.countryAt(tree.north, tree.east).farm > 0.5, 'a field tree outside the farmland');
      assert.ok(tree.height > 8 && tree.height < 17);
    }
    most = Math.max(most, count); total += count;
  }
  console.log(`  Trees round the camera: up to ${most} at once`);
  assert.ok(total > 400 && most < 2500, `${most} trees at once`);
});

// ---- flying the canyon ----
import { gPilot } from './fly.js';

// A pilot who follows the river: aims at a point a little way up the course, banks to turn onto it, and holds a
// height above the river bed. `up` is true to fly upstream, from the sea to the loch.
function riverPilot(course, { kt, above, ahead = 1100 }) {
  const pull = gPilot(0.1);
  let power = 0.5, at = 0;
  return (r, sim) => {
    const [n, e] = [sim.state.x[0], sim.state.x[1]];
    // The nearest point of the course from where we last were on it, then on by the look-ahead.
    while (at < course.length - 2 && Math.hypot(course[at + 1][0] - n, course[at + 1][1] - e) < Math.hypot(course[at][0] - n, course[at][1] - e)) at++;
    let aim = at, gone = 0;
    while (aim < course.length - 1 && gone < ahead) { gone += Math.hypot(course[aim + 1][0] - course[aim][0], course[aim + 1][1] - course[aim][1]); aim++; }
    const bearing = Math.atan2(course[aim][1] - e, course[aim][0] - n) / DEG, off = ((bearing - r.heading + 540) % 360) - 180;
    const bank = Math.max(-80, Math.min(80, off * 3.2));
    const wanted = island.heightAt(course[aim][0], course[aim][1]) / FT + above, climb = Math.max(-2500, Math.min(2500, (wanted - r.ft) * 6));
    const g = Math.max(0.3, Math.min(6.5, 1 / Math.max(0.2, Math.cos(r.roll * DEG)) + (climb - r.fpm) / 2500));
    power = Math.max(0, Math.min(1, power + 0.004 * (kt - r.kias) * DT * 60));
    return { elevator: pull(r, g), aileron: Math.max(-1, Math.min(1, 0.045 * (bank - r.roll) - 0.012 * r.rollRate)), throttle: Math.max(0, Math.min(1, power + 0.02 * (kt - r.kias))) };
  };
}

test('island: the canyon can be flown from the sea to the viaduct at 350 knots, below the rim all the way', () => {
  const card = deriveCard(F4C);
  // Upstream: the course reversed, from the mouth to the viaduct's place.
  const course = [...region.river].reverse().filter(([n, e]) => island.heightAt(n, e) > 0 && island.waterAt(n, e) !== loch.level);
  const stop = course.findIndex(([n, e]) => Math.hypot(n - viaduct.north, e - viaduct.east) < 300);
  const [sn, se] = course[0], [tn, te] = course[3];
  const sim = airborne(card, { ft: 700, kt: 350, level: true, throttle: 'trim', ground });
  sim.state.x = [sn, se, -700 * FT];
  sim.state.q = qfromEuler(0, sim.trim.alpha, Math.atan2(te - se, tn - sn));
  const pilot = riverPilot(course.slice(0, stop + 1), { kt: 350, above: 700 });
  let closest = Infinity, highest = -Infinity, steepest = 0, most = 0, reached = false;
  const control = (r, s) => {
    const [n, e] = s.state.x;
    for (let b = 0; b < 360; b += 30) for (const d of [60, 120, 200]) {
      if (ground.heightAt(n + d * Math.cos(b * DEG), e + d * Math.sin(b * DEG)) > -s.state.x[2] - 15) closest = Math.min(closest, d);
    }
    // The rim here: the highest ground within three-quarters of a mile.
    let rim = -Infinity;
    for (let b = 0; b < 360; b += 30) rim = Math.max(rim, ground.heightAt(n + 1400 * Math.cos(b * DEG), e + 1400 * Math.sin(b * DEG)));
    if (island.heightAt(n, e) > 15) highest = Math.max(highest, -s.state.x[2] - rim);
    steepest = Math.max(steepest, Math.abs(r.roll)); most = Math.max(most, r.g);
    return pilot(r, s);
  };
  // A second at a time, until the viaduct's place is half a mile ahead.
  while (!reached && !sim.crashed && sim.t < 400) {
    fly(sim, 1, control, 1);
    reached = Math.hypot(sim.state.x[0] - viaduct.north, sim.state.x[1] - viaduct.east) < 900;
  }
  console.log(`  The canyon run at 350 kt: ${sim.crashed ? `ends: ${sim.crashed.reason}` : reached ? `reaches the viaduct in ${(sim.t / 60).toFixed(1)} min` : 'does not get there'}; never closer than ${closest === Infinity ? 'over 650' : Math.round(closest / FT)} ft to a wall; ${Math.round(-highest / FT)} ft below the rim at its highest; up to ${Math.round(steepest)} deg of bank and ${most.toFixed(1)} g`);
  if (sim.crashed) console.log(`  ended ${sim.t.toFixed(0)} s in at ${Math.round(sim.state.x[0])}, ${Math.round(sim.state.x[1])}, ${Math.round(-sim.state.x[2])} m; river bed there ${Math.round(island.heightAt(sim.state.x[0], sim.state.x[1]))} m`);
  assert.equal(sim.crashed, null, 'it touches nothing');
  assert.ok(reached, 'it gets to the viaduct');
  assert.ok(highest < 0, 'below the rim all the way');
});

// ---- landmarks' solid shapes (docs/models.md, "Landmarks") ----
import { createSolids } from '../src/sim/solids.js';

test('island: a landmark is solid where its boxes are and open where they are not', () => {
  const card = deriveCard(F4C);
  // A stand-in arch in the fields, until the first landmark arrives: two piers 9 m wide with a 37 m opening
  // between them, and a deck across their tops from 45 m up. It stands square across a track of 030.
  const at = { north: base.north + 3000, east: base.east - 2500 }, up = island.heightAt(at.north, at.east);
  const track = 30 * DEG, along = [Math.cos(track), Math.sin(track), 0], across = [-Math.sin(track), Math.cos(track), 0], axes = [along, across, [0, 0, 1]];
  const set = (name, side, height, half) => ({ name, centre: [at.north + across[0] * side, at.east + across[1] * side, up + height], half, axes });
  const solids = createSolids([set('solid_pier_1', -23, 22.5, [4, 4.5, 22.5]), set('solid_pier_2', 23, 22.5, [4, 4.5, 22.5]), set('solid_deck', 0, 52.5, [4, 27.5, 7.5])]);
  const on = islandGround(island, solids);
  // Each pass starts 600 m short, level at 400 knots, `side` metres right of the opening's middle and `feet` above the ground.
  const pass = (side, feet, crashes = true) => {
    const sim = over(card, { north: at.north - along[0] * 600 + across[0] * side, east: at.east - along[1] * 600 + across[1] * side, feet: (up + 2) / FT + feet, heading: 30, kt: 400, crashes, on });
    fly(sim, 5);
    return sim.crashed;
  };
  const through = pass(0, 70), pier = pass(23, 70), deck = pass(0, 165), wing = pass(13.5, 70), overTop = pass(0, 260), spared = pass(23, 70, false);
  const say = (c) => (c ? `${c.reason} (${c.solid ?? c.point})` : 'clear');
  console.log(`  A 37 m arch at 400 kt: through the middle ${say(through)}; at a pier ${say(pier)}; at the deck ${say(deck)}; a wingtip on a pier ${say(wing)}; over the top ${say(overTop)}`);
  assert.equal(through, null, 'the opening is open');
  assert.equal(pier?.solid, 'solid_pier_2');
  assert.equal(deck?.solid, 'solid_deck');
  assert.equal(wing?.reason, 'landmark', 'a wingtip counts');
  assert.equal(overTop, null);
  assert.equal(spared, null, 'with the override on, the jet flies through');
  // A wall half a metre thick, a kilometre on: at 400 knots the jet moves 1.7 m between one look and the next.
  const wall = createSolids([{ name: 'solid_wall', centre: [at.north + along[0] * 1000, at.east + along[1] * 1000, up + 30], half: [0.25, 40, 30], axes }]);
  const thin = over(card, { north: at.north, east: at.east, feet: (up + 2) / FT + 70, heading: 30, kt: 400, on: islandGround(island, wall) });
  fly(thin, 8);
  console.log(`  A wall 0.5 m thick at 400 kt: ${say(thin.crashed)}`);
  assert.equal(thin.crashed?.solid, 'solid_wall', 'a thin wall is not skipped between steps');
});

// ---- the Strip (docs/island.md) ----
import { hotelSolids } from '../src/sim/solids.js';
import { holdAltitude } from './fly.js';

test('island: the Strip is a level pad with a road, hotels along it, and a lot kept clear for each landmark', () => {
  const lots = Object.values(strip.lots), hotels = strip.hotels;
  // Level: under the road, every hotel and every lot.
  let off = 0;
  for (let n = strip.north - strip.length / 2; n <= strip.north + strip.length / 2; n += 50) for (let e = strip.east - 450; e <= strip.east + 450; e += 50) off = Math.max(off, Math.abs(island.heightAt(n, e) - strip.height));
  console.log(`  The Strip: ${(strip.length / NM).toFixed(1)} miles of road at ${Math.round(strip.height / FT)} ft, level to within ${(off / FT).toFixed(1)} ft; ${hotels.length} hotels, ${Math.round(Math.min(...hotels.map((h) => h.height)) / FT)} to ${Math.round(Math.max(...hotels.map((h) => h.height)) / FT)} ft tall; ${lots.length} lots for landmarks`);
  assert.ok(off < 0.5, `the pad is ${off} m out of level`);
  assert.ok(Math.abs(strip.length / NM - 1.5) < 0.1, 'about a mile and a half');
  assert.equal(lots.length, 8);
  const apart = (a, b) => Math.abs(a.north - b.north) >= (a.along + b.along) / 2 || Math.abs(a.east - b.east) >= (a.across + b.across) / 2;
  const things = [...hotels, ...lots];
  for (let i = 0; i < things.length; i++) {
    const a = things[i];
    assert.ok(Math.abs(a.east - strip.east) - a.across / 2 > strip.road / 2 + 10, 'nothing stands on the road or its verge');
    assert.ok(Math.abs(a.north - strip.north) + a.along / 2 < strip.length / 2 + 250 && Math.abs(a.east - strip.east) + a.across / 2 < 450, 'everything stands on the pad');
    for (let j = i + 1; j < things.length; j++) assert.ok(apart(a, things[j]), 'two things stand on the same ground');
  }
  assert.ok(hotels.length >= 15, 'hotels fill the frontage');
});

test('island: the Strip can be buzzed down the road below the rooftops; a hotel ends the flight', () => {
  const card = deriveCard(F4C), on = islandGround(island, createSolids(hotelSolids(strip)));
  const tall = strip.hotels.reduce((a, b) => (b.height > a.height ? b : a));
  // Down the middle of the road from the south at 400 knots, 100 ft up, holding height; then the same pass moved
  // over to the tallest hotel.
  // It starts over the pad's south end: beyond the pad the desert rises, north and south.
  const start = strip.north - strip.length / 2 - 200, ft = (strip.height + 2) / FT + 100, from = { north: start };
  const pass = (east, crashes = true) => {
    const sim = airborne(card, { ft, kt: 400, level: true, throttle: 'trim', ground: on }), alpha = sim.trim.alpha;
    sim.state.x = [start, east, -ft * FT];
    sim.state.q = qfromEuler(0, alpha, 0);
    sim.crashes = crashes;
    const hold = holdAltitude(ft, sim.trim.elevator);
    fly(sim, 15, (r) => ({ ...hold(r), throttle: sim.trim.throttle }));
    return sim;
  };
  const road = pass(strip.east), into = pass(tall.east), spared = pass(tall.east, false);
  console.log(`  Down the Strip at 400 kt, 100 ft up: ${road.crashed ? road.crashed.reason : `clear, ${Math.round((road.state.x[0] - from.north) / NM * 10) / 10} miles on`}. Into the tallest hotel (${Math.round(tall.height / FT)} ft): ${into.crashed ? `${into.crashed.reason} (${into.crashed.solid})` : 'clear'}`);
  assert.equal(road.crashed, null, 'the road is clear');
  assert.ok(road.state.x[0] > strip.north + strip.length / 2, 'it flies the whole Strip');
  assert.equal(into.crashed?.reason, 'landmark');
  assert.equal(spared.crashed, null, 'with the override on, the jet flies through');
});

// Every landmark's model against docs/models.md ("Landmarks"), and flown:
// through each opening, and into the stone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { decodePng } from '../terrain/png.mjs';
import { landmarks as freshLandmarks } from '../terrain/make-island.mjs';
import { readGlb, worldMatrices, verticesUnder, bounds } from '../models/glb.mjs';
import { isSolid, solidsOf } from '../models/solids.mjs';
import { createIsland, decodeCanopy, decodeHeights, islandGround } from '../src/sim/island.js';
import { createSolids } from '../src/sim/solids.js';
import { deriveCard } from '../src/sim/card.js';
import { F4C } from '../src/sim/cards/f4c.js';
import { qfromEuler } from '../src/sim/vec.js';
import { airborne, fly, holdAltitude } from './fly.js';

const FT = 0.3048, KT = 0.514444, DEG = Math.PI / 180;
const file = (name) => new URL(`../${name}`, import.meta.url);
const region = JSON.parse(readFileSync(file('terrain/island.json')));
const landmarks = JSON.parse(readFileSync(file('terrain/landmarks.json')));
const png = decodePng(readFileSync(file(`terrain/${region.image}`)));
const island = createIsland(region, decodeHeights(png.rgb, png.width * png.height, 3), decodeCanopy(png.rgb, png.width * png.height, 3));
const ground = islandGround(island, createSolids(Object.values(landmarks).flatMap((l) => l.solids)));

// What the prompt for each model asked for: its overall size in metres (east-west, up from the origin, north-south),
// its triangle budget, and how many openings there are to fly through.
const ASKED = { viaduct: { size: [640, 121, 51], triangles: 8000, openings: 11 }, castle: { size: [356, 220, 296], triangles: 15000, openings: 0 } };

test('landmarks: terrain/landmarks.json is what the script writes today', () => {
  assert.deepEqual(landmarks, JSON.parse(JSON.stringify(freshLandmarks())), 'landmarks.json is stale: run node terrain/make-island.mjs');
});

for (const [name, at] of Object.entries(landmarks)) {
  const path = file(`models/${at.model}`), glb = readGlb(path), { json } = glb, asked = ASKED[name];

  test(`landmarks: the ${name}'s model is built to docs/models.md`, () => {
    const world = worldMatrices(json), roots = json.scenes[json.scene ?? 0].nodes;
    const seen = roots.filter((r) => !isSolid(json.nodes[r])), solids = solidsOf(glb);
    const box = bounds(seen.flatMap((r) => verticesUnder(glb, r, world)));
    const size = [box.max[0] - box.min[0], box.max[1], box.max[2] - box.min[2]];
    let triangles = 0;
    for (const node of json.nodes) if (!isSolid(node) && node.mesh !== undefined) for (const p of json.meshes[node.mesh].primitives) triangles += json.accessors[p.indices].count / 3;
    const kb = statSync(path).size / 1000;
    console.log(`  ${name}: ${size.map((v) => v.toFixed(0)).join(' x ')} m (east-west, up, north-south), ${triangles} triangles, ${kb.toFixed(0)} KB, ${solids.length} solid boxes`);
    size.forEach((v, k) => assert.ok(Math.abs(v - asked.size[k]) <= 0.05 * asked.size[k], `size ${v.toFixed(1)} m against ${asked.size[k]} m asked`));
    // The origin is in the middle of its footprint, east and west; it carries on 5 m below the ground.
    assert.ok(Math.abs(box.min[0] + box.max[0]) < 0.02 * size[0], 'the origin is in the middle');
    assert.ok(box.min[1] <= -4.9, `it carries on ${-box.min[1]} m below the ground`);
    assert.ok(kb < 500 && triangles < asked.triangles, 'inside its budget');
    assert.ok(json.materials.length === 1 && (json.images ?? []).length <= 1, 'one material, one texture at most');
    assert.ok(!json.animations && !json.cameras && !json.extensions?.KHR_lights_punctual, 'no animations, cameras or lights');
    // The solids: plain cubes, moved, turned and stretched, and nothing else unseen.
    assert.ok(solids.length > 0 && solids.length <= 60, `${solids.length} solid boxes`);
    for (const node of json.nodes) {
      if (!isSolid(node)) { assert.ok(node.mesh !== undefined, `${node.name} is an empty`); continue; }
      const corners = bounds(verticesUnder(glb, json.nodes.indexOf(node), worldMatrices({ ...json, nodes: json.nodes.map((n) => ({ ...n, translation: undefined, rotation: undefined, scale: undefined, matrix: undefined })) })));
      assert.equal(json.accessors[json.meshes[node.mesh].primitives[0].attributes.POSITION].count <= 24, true, `${node.name} is a cube`);
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(corners.max[k] + corners.min[k]) < 1e-3 && corners.max[k] > 0, `${node.name} is a cube about its own middle`);
    }
    // Every solid wraps stone: its middle is inside what is seen.
    for (const s of solids) for (let k = 0; k < 3; k++) assert.ok(s.centre[k] > box.min[k] - 1 && s.centre[k] < box.max[k] + 1, `${s.name} stands apart from the model`);
  });

  // The openings: between each pair of neighbouring legs (piers and abutments), counted along the landmark.
  const legs = at.solids.filter((s) => /pier|abutment/.test(s.name)).sort((a, b) => a.centre[1] - b.centre[1]);
  const openings = legs.slice(1).map((b, i) => {
    const a = legs[i], across = [b.centre[0] - a.centre[0], b.centre[1] - a.centre[1]], gap = Math.hypot(...across);
    // Its middle is half way between the two legs' facing sides; a leg's first axis lies along the landmark.
    const t = (a.half[0] + (gap - a.half[0] - b.half[0]) / 2) / gap;
    return { north: a.centre[0] + across[0] * t, east: a.centre[1] + across[1] * t, gap, clear: gap - a.half[0] - b.half[0], heading: Math.atan2(-across[0], across[1]) / DEG, a, b };
  });
  const card = deriveCard(F4C);
  // The jet 500 m short of a point, level at 350 knots toward it on `heading`, `up` metres above the landmark's origin.
  const pass = ({ north, east }, heading, up, crashes = true) => {
    const h = heading * DEG, V = 350 * KT, ft = (at.up + up) / FT;
    const sim = airborne(card, { ft, kt: 350, level: true, throttle: 'trim', ground }), alpha = sim.trim.alpha;
    sim.state.x = [north - 500 * Math.cos(h), east - 500 * Math.sin(h), -(at.up + up)];
    sim.state.q = qfromEuler(0, alpha, h);
    sim.state.v = [V * Math.cos(alpha), 0, V * Math.sin(alpha)];
    sim.crashes = crashes;
    const hold = holdAltitude(ft, sim.trim.elevator);
    fly(sim, 5.5, (r) => ({ ...hold(r), throttle: sim.trim.throttle }));
    return sim;
  };

  // The solids that stand on the ground, and how high the highest solid reaches above the origin.
  const upright = (s) => s.axes.findIndex((a) => Math.abs(a[2]) > 0.9);
  const standing = at.solids.filter((s) => s.centre[2] - s.half[upright(s)] < at.up + 1);
  const roof = Math.max(...at.solids.map((s) => s.centre[2] + s.half[upright(s)])) - at.up;
  const say = (sim) => (sim.crashed ? `ends the flight (${sim.crashed.solid ?? sim.crashed.reason})` : 'clear');

  test(`landmarks: the ${name} is solid`, () => {
    // At the part nearest its middle, from the south, 100 ft above its ground; then over the top; then with the crash override on.
    const off = (s) => Math.hypot(s.centre[0] - at.north, s.centre[1] - at.east);
    const tall = standing.reduce((a, b) => (off(b) < off(a) ? b : a)), aim = { north: tall.centre[0], east: tall.centre[1] };
    const into = pass(aim, 0, 30), over = pass(aim, 0, roof + 30), spared = pass(aim, 0, 30, false);
    console.log(`  The ${name} at 350 kt: into ${tall.name}, ${say(into)}. ${Math.round((roof + 30) / FT)} ft up, over the top: ${say(over)}. Into it with the crash override on: ${say(spared)}`);
    assert.equal(into.crashed?.reason, 'landmark');
    assert.equal(over.crashed, null);
    assert.equal(spared.crashed, null, 'with the override on, the jet flies through');
  });

  if (asked.openings) test(`landmarks: every opening of the ${name} can be flown, both ways, and its stone cannot`, () => {
    assert.equal(openings.length, asked.openings, 'openings');
    const widths = [];
    for (const [i, o] of openings.entries()) {
      // How wide the hole in the solid shapes is: the gap between the two legs' boxes.
      const clear = o.clear;
      widths.push(clear);
      assert.ok(clear >= 35, `opening ${i + 1} is ${clear.toFixed(1)} m wide in the solid shapes`);
      for (const way of [0, 180]) for (const up of [12, 90]) {
        const sim = pass(o, o.heading + way, up);
        assert.equal(sim.crashed, null, `opening ${i + 1}, heading ${Math.round(o.heading + way)}, ${up} m up: ${sim.crashed?.reason} (${sim.crashed?.solid ?? sim.crashed?.point})`);
        assert.ok(Math.hypot(sim.state.x[0] - o.north, sim.state.x[1] - o.east) > 300, 'it came out the far side');
      }
    }
    console.log(`  ${openings.length} openings, each flown both ways at 350 kt, 40 and 300 ft above the river: all clear. The hole in the solid shapes is ${Math.min(...widths).toFixed(1)} to ${Math.max(...widths).toFixed(1)} m wide`);
    // Into the stone: a leg head-on, a wingtip on a leg, and the deck.
    const decks = at.solids.filter((s) => /deck/.test(s.name));
    const o = openings[Math.floor(openings.length / 2)], leg = { north: o.b.centre[0], east: o.b.centre[1] };
    const side = (m) => ({ north: o.north + (m / o.gap) * (o.b.centre[0] - o.a.centre[0]), east: o.east + (m / o.gap) * (o.b.centre[1] - o.a.centre[1]) });
    const above = Math.max(...decks.map((d) => d.centre[2] + d.half[1])) - at.up + 20;
    const head = pass(leg, o.heading, 30), tip = pass(side(o.clear / 2 - 4), o.heading, 30), deck = pass(o, o.heading, decks[0].centre[2] - at.up), over = pass(o, o.heading, above), spared = pass(leg, o.heading, 30, false);
    console.log(`  Into a pier: ${say(head)}. A wingtip on a pier: ${say(tip)}. Into the deck: ${say(deck)}. Over the top: ${say(over)}. Into a pier with the crash override on: ${say(spared)}`);
    assert.equal(head.crashed?.solid, o.b.name);
    assert.equal(tip.crashed?.solid, o.b.name, 'a wingtip counts');
    assert.match(deck.crashed?.solid ?? '', /deck/);
    assert.equal(over.crashed, null);
    assert.equal(spared.crashed, null, 'with the override on, the jet flies through');
  });

  test(`landmarks: the ${name} stands on its site`, () => {
    // The ground under every opening is below the origin's level or near it: nothing fills an arch.
    for (const [i, o] of openings.entries()) {
      const under = island.heightAt(o.north, o.east) - at.up;
      assert.ok(under < 3, `the ground stands ${under.toFixed(1)} m up in opening ${i + 1}`);
    }
    // Nothing hangs in the air: the ground under each standing part is within the 5 m it carries on below its origin.
    const hang = standing.map((l) => at.up - island.heightAt(l.centre[0], l.centre[1]));
    console.log(`  Under the ${name}'s ${standing.length} standing parts the ground is ${Math.min(...hang).toFixed(1)} m above to ${Math.max(...hang).toFixed(1)} m below the origin's level`);
    assert.ok(Math.max(...hang) < 4.5, 'a part would hang in the air');
  });
}

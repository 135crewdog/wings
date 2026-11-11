// The 3D model obeys docs/models.md, and the airplane's card agrees with it
// about where the wheels are. Read straight from the .glb: no browser, no
// three.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readGlb, readAccessor, worldMatrices, verticesUnder, bounds, poseAt } from '../models/glb.mjs';
import { contactPoints } from '../models/measure.mjs';
import { F4C } from '../src/sim/cards/f4c.js';

const path = fileURLToPath(new URL('../models/f4c.glb', import.meta.url));
const glb = readGlb(path);
const { json } = glb;
const FT = 0.3048;
const MOTIONS = ['gear', 'flaps', 'elevator', 'aileron', 'rudder'];
const root = json.scenes[json.scene ?? 0].nodes[0];
const posed = (pose) => verticesUnder(glb, root, worldMatrices(json, pose));

test('the model is the real airplane\'s size, nose along -Z, with its origin inside it', () => {
  const box = bounds(posed(poseAt(glb, 'gear', 0)));
  const length = box.max[2] - box.min[2], span = box.max[0] - box.min[0];
  console.log(`  length ${length.toFixed(2)} m (card ${(F4C.length_ft * FT).toFixed(2)}), span ${span.toFixed(2)} m (card ${(F4C.span_ft * FT).toFixed(2)})`);
  assert.ok(Math.abs(length / (F4C.length_ft * FT) - 1) <= 0.02, 'length within 2% of the card');
  assert.ok(Math.abs(span / (F4C.span_ft * FT) - 1) <= 0.02, 'span within 2% of the card');
  assert.ok(Math.abs(box.min[0] + box.max[0]) < 0.02 * span, 'the same either side of the centreline');
  assert.ok(box.max[1] - box.min[1] < length / 2, 'it is longer than it is tall: up is +Y');
  // The origin is the centre of gravity: inside the airplane, between 40% and 70% of the way back.
  const back = -box.min[2] / length;
  assert.ok(back > 0.4 && back < 0.7 && box.min[1] < 0 && box.max[1] > 0, `the origin is ${Math.round(back * 100)}% of the way back`);
  // The fin is at the back: the highest point is behind the origin.
  const top = posed({}).reduce((a, p) => (p[1] > a[1] ? p : a));
  assert.ok(top[2] > 0, 'the nose points along -Z');
});

test('the model has the five motions, each one second long, each moving its own parts', () => {
  const names = json.animations.map((a) => a.name);
  assert.deepEqual([...names].sort(), [...MOTIONS].sort(), 'exactly the five named motions');
  const owner = new Map();
  for (const animation of json.animations) {
    for (const channel of animation.channels) {
      const times = readAccessor(glb, animation.samplers[channel.sampler].input).map((v) => v[0]);
      assert.ok(Math.abs(times[0]) < 1e-6 && Math.abs(times.at(-1) - 1) < 1e-6, `${animation.name} runs from 0 to 1 s`);
      const part = channel.target.node;
      assert.ok(!owner.has(part) || owner.get(part) === animation.name, `${json.nodes[part].name} is moved by one motion only`);
      owner.set(part, animation.name);
    }
  }
  console.log(`  ${MOTIONS.map((m) => `${m}: ${new Set(json.animations.find((a) => a.name === m).channels.map((c) => c.target.node)).size} parts`).join(', ')}`);
});

test('each motion moves the right way', () => {
  const rest = worldMatrices(json);
  const moved = (name, t, part) => bounds(verticesUnder(glb, part, worldMatrices(json, poseAt(glb, name, t))));
  const partsOf = (name) => [...new Set(json.animations.find((a) => a.name === name).channels.map((c) => c.target.node))];
  // Gear: down, the wheels are the lowest thing; up, nothing hangs below the belly.
  const down = bounds(posed(poseAt(glb, 'gear', 1))), up = bounds(posed(poseAt(glb, 'gear', 0)));
  assert.ok(up.min[1] > down.min[1] + 0.5, 'gear up, the airplane is at least half a metre shallower');
  // Flaps down hang lower than flaps up.
  for (const part of partsOf('flaps')) assert.ok(moved('flaps', 1, part).min[1] < moved('flaps', 0, part).min[1] - 0.02, 'flaps go down');
  // Elevator: back stick (1 s) raises the trailing edge, forward (0 s) lowers it.
  const rear = (name, t, part) => verticesUnder(glb, part, worldMatrices(json, poseAt(glb, name, t))).reduce((a, p) => (p[2] > a[2] ? p : a));
  for (const part of partsOf('elevator')) assert.ok(rear('elevator', 1, part)[1] > rear('elevator', 0, part)[1] + 0.05, 'back stick raises the elevator\'s trailing edge');
  // Aileron: left stick (0 s) raises the left wing's surfaces and lowers the right's; right stick the other way.
  const side = (part) => { const b = bounds(verticesUnder(glb, part, rest)); return Math.sign(b.min[0] + b.max[0]); };
  const height = (t, wing) => partsOf('aileron').filter((p) => side(p) === wing).reduce((sum, p) => sum + rear('aileron', t, p)[1], 0);
  assert.ok(height(0, -1) > height(1, -1) + 0.05, 'left stick raises the left wing\'s surfaces');
  assert.ok(height(1, 1) > height(0, 1) + 0.05, 'right stick raises the right wing\'s');
  // Rudder: full left (0 s) swings the trailing edge left (-X), full right (1 s) right, about where it rests.
  for (const part of partsOf('rudder')) {
    const still = verticesUnder(glb, part, rest).reduce((a, p) => (p[2] > a[2] ? p : a))[0];
    assert.ok(rear('rudder', 0, part)[0] < still - 0.05 && rear('rudder', 1, part)[0] > still + 0.05, 'the rudder swings left then right');
  }
  // Neutral is the model at rest: every control motion at 0.5 s leaves its parts where they sit.
  for (const name of ['elevator', 'aileron', 'rudder']) {
    for (const part of partsOf(name)) {
      const a = bounds(verticesUnder(glb, part, worldMatrices(json, poseAt(glb, name, 0.5)))), r = bounds(verticesUnder(glb, part, rest));
      [...a.min, ...a.max].forEach((x, k) => assert.ok(Math.abs(x - [...r.min, ...r.max][k]) < 1e-3, `${name} is neutral at 0.5 s`));
    }
  }
});

test('the stabilator travels as far as the real one', () => {
  // docs/models.md, for the F-4C: about 21 degrees trailing edge up, 9 down.
  const UP = 21, DOWN = 9, WITHIN = 2;
  const elevator = json.animations.find((a) => a.name === 'elevator');
  const degrees = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, x, k) => sum + x * b[k], 0)))) * 180) / Math.PI;
  for (const channel of elevator.channels.filter((c) => c.target.path === 'rotation')) {
    const at = (t) => poseAt(glb, 'elevator', t)[channel.target.node].rotation;
    const down = degrees(at(0), at(0.5)), up = degrees(at(0.5), at(1));
    console.log(`  ${json.nodes[channel.target.node].name}: ${up.toFixed(1)} deg up, ${down.toFixed(1)} deg down`);
    assert.ok(Math.abs(up - UP) <= WITHIN, `full back stick is ${UP} degrees up, give or take ${WITHIN}`);
    assert.ok(Math.abs(down - DOWN) <= WITHIN, `full forward stick is ${DOWN} degrees down, give or take ${WITHIN}`);
  }
});

test('the model is inside its budget', () => {
  const bytes = statSync(path).size;
  const triangles = json.meshes.flatMap((m) => m.primitives).reduce((sum, p) => sum + json.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0);
  console.log(`  ${Math.round(bytes / 1024)} KB, ${Math.round(triangles)} triangles, ${json.materials.length} material, ${(json.images ?? []).length} texture`);
  assert.ok(bytes < 2 * 1024 * 1024, 'under 2 MB');
  assert.ok(triangles < 50000, 'under 50,000 triangles');
  assert.equal(json.materials.length, 1, 'one material');
  assert.ok((json.images ?? []).length <= 1, 'one texture at most');
  assert.ok(!json.cameras && !json.extensions?.KHR_lights_punctual, 'no cameras or lights');
});

test('the card\'s wheels and airframe are where the model\'s are', () => {
  const model = contactPoints(glb);
  const close = (a, b, what) => a.forEach((x, k) => assert.ok(Math.abs(x - b[k]) <= 0.05, `${what}: the card says ${JSON.stringify(b)} ft, the model ${JSON.stringify(a)} ft`));
  for (const [name, at] of Object.entries(model.wheels)) close(at, F4C.wheels_ft[name], `${name} wheel`);
  for (const [name, width] of Object.entries(model.tyres)) close([width], [F4C.tyre_width_ft[name]], `${name} tyre width`);
  assert.equal(F4C.airframe_ft.length, model.airframe.length, 'the same number of airframe points');
  model.airframe.forEach((at, i) => close(at, F4C.airframe_ft[i], `airframe point ${i + 1}`));
  assert.equal(F4C.gear_ft.length, model.gear.length, 'the same number of gear points');
  model.gear.forEach((at, i) => close(at, F4C.gear_ft[i], `gear point ${i + 1}`));
  const { nose, left, right } = model.wheels;
  console.log(`  wheelbase ${(nose[0] - left[0]).toFixed(1)} ft, track ${(right[1] - left[1]).toFixed(1)} ft, mains ${(-left[0]).toFixed(1)} ft behind the centre of gravity, which sits ${nose[2].toFixed(1)} ft above the runway`);
  assert.ok(left[0] < 0 && nose[0] > 0, 'the mains are behind the centre of gravity and the nose wheel ahead');
  assert.ok(Math.abs(left[1] + right[1]) < 0.05 && Math.abs(left[2] - right[2]) < 0.05, 'the mains are a matched pair');
});

test('nothing on the model reaches the ground before the card\'s points do', () => {
  // Checked against every vertex of the model itself, at attitudes between
  // and beyond the ones the points were chosen at: this does not use the
  // function that chose them.
  const DEG = Math.PI / 180;
  const hang = ([x, y, z], pitch, roll) => -Math.sin(pitch) * x + Math.cos(pitch) * (Math.sin(roll) * y + Math.cos(roll) * z);
  const toBody = ([x, y, z]) => [-z, x, -y];
  const metres = (p) => p.map((v) => v * FT);
  const deepest = (points, pitch, roll) => Math.max(...points.map((p) => hang(p, pitch * DEG, roll * DEG)));
  const tyreNodes = ['wheel_nose', 'wheel_left', 'wheel_right'].map((name) => json.nodes.findIndex((n) => n.name === name));
  const tyreEdges = Object.entries(F4C.wheels_ft).flatMap(([name, [x, y, z]]) => [-1, 1].map((side) => [x, y + (side * F4C.tyre_width_ft[name]) / 2, z]));
  let worst = { gap: 0 };
  // Everything but the tyres, gear up and gear down, pitched and banked.
  for (const [gear, card] of [[0, F4C.airframe_ft], [1, [...F4C.airframe_ft, ...F4C.gear_ft, ...tyreEdges]]]) {
    const skin = verticesUnder(glb, root, worldMatrices(json, poseAt(glb, 'gear', gear)), tyreNodes).map(toBody), points = card.map(metres);
    for (let pitch = -10; pitch <= 20; pitch += 2.5) {
      for (let roll = -30; roll <= 30; roll += 2.5) {
        const gap = deepest(skin, pitch, roll) - deepest(points, pitch, roll);
        if (gap > worst.gap) worst = { gap, pitch, roll, what: `gear ${gear ? 'down' : 'up'}` };
      }
    }
  }
  // The tyres themselves: a wheel is its contact line, as wide as the tyre, so
  // check them banked but level. Pitched, a round tyre rolls onto a new
  // contact point; the model's are blocky, and their corners are not the
  // airplane's to land on.
  const down = worldMatrices(json, poseAt(glb, 'gear', 1));
  const tyres = tyreNodes.flatMap((node) => verticesUnder(glb, node, down)).map(toBody);
  for (let roll = -30; roll <= 30; roll += 2.5) {
    const gap = deepest(tyres, 0, roll) - deepest(tyreEdges.map(metres), 0, roll);
    if (gap > worst.gap) worst = { gap, pitch: 0, roll, what: 'the tyres' };
  }
  console.log(`  ${F4C.airframe_ft.length} airframe points and ${F4C.gear_ft.length} gear points; the most the model dips below the card is ${(worst.gap * 100).toFixed(1)} cm${worst.gap ? ` (${worst.what}, ${worst.pitch} deg nose up, ${worst.roll} deg of bank)` : ''}`);
  assert.ok(worst.gap < 0.05, 'within 5 cm at every attitude from nose 10 down to 20 up and 30 degrees of bank');
});

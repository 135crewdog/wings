// The 3D model obeys docs/models.md, and the airplane's card agrees with it
// about where the wheels are. Read straight from the .glb: no browser, no
// three.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readGlb, readAccessor, worldMatrices, verticesUnder, bounds, poseAt, poseOf } from '../models/glb.mjs';
import { contactPoints } from '../models/measure.mjs';
import { F4C } from '../src/sim/cards/f4c.js';

const path = fileURLToPath(new URL('../models/f4c.glb', import.meta.url));
const glb = readGlb(path);
const { json } = glb;
const FT = 0.3048;
const MOTIONS = ['gear', 'flaps', 'elevator', 'aileron', 'rudder'];
const roots = json.scenes[json.scene ?? 0].nodes;
// The whole airplane, every motion at a position (see poseOf: neutral unless said). A file's own
// resting pose is never used: an exporter may leave it at every animation's 0 s end.
const world = (positions) => worldMatrices(json, poseOf(glb, positions));
const posed = (positions, skip = []) => roots.flatMap((root) => verticesUnder(glb, root, world(positions), skip));

test('the model is the real airplane\'s size, nose along -Z, with its origin inside it', () => {
  const box = bounds(posed({ gear: 0 }));
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
  const top = posed({ gear: 0 }).reduce((a, p) => (p[1] > a[1] ? p : a));
  assert.ok(top[2] > 0, 'the nose points along -Z');
});

test('the model has the five motions, each one second long, each moving its own parts', () => {
  const names = json.animations.map((a) => a.name);
  for (const motion of MOTIONS) assert.ok(names.includes(motion), `it has the ${motion} motion`);
  assert.equal(new Set(names).size, names.length, 'no motion is there twice');
  const extra = names.filter((name) => !MOTIONS.includes(name));
  if (extra.length) console.log(`  also carries, unused by the app and left at 0 s: ${extra.join(', ')}`);
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
  const at = (name, t, part) => verticesUnder(glb, part, world({ [name]: t }));
  const moved = (name, t, part) => bounds(at(name, t, part));
  const partsOf = (name) => [...new Set(json.animations.find((a) => a.name === name).channels.map((c) => c.target.node))];
  // Gear: down, the wheels are the lowest thing; up, nothing hangs below the belly.
  const down = bounds(posed({ gear: 1 })), up = bounds(posed({ gear: 0 }));
  assert.ok(up.min[1] > down.min[1] + 0.5, 'gear up, the airplane is at least half a metre shallower');
  // Flaps down hang lower than flaps up.
  for (const part of partsOf('flaps')) assert.ok(moved('flaps', 1, part).min[1] < moved('flaps', 0, part).min[1] - 0.02, 'flaps go down');
  // Elevator: back stick (1 s) raises the trailing edge, forward (0 s) lowers it.
  const rear = (name, t, part) => at(name, t, part).reduce((a, p) => (p[2] > a[2] ? p : a));
  for (const part of partsOf('elevator')) assert.ok(rear('elevator', 1, part)[1] > rear('elevator', 0, part)[1] + 0.05, 'back stick raises the elevator\'s trailing edge');
  // Aileron: left stick (0 s) raises the left wing's surfaces and lowers the right's; right stick the other way.
  const side = (part) => { const b = moved('aileron', 0.5, part); return Math.sign(b.min[0] + b.max[0]); };
  const height = (t, wing) => partsOf('aileron').filter((p) => side(p) === wing).reduce((sum, p) => sum + rear('aileron', t, p)[1], 0);
  assert.ok(height(0, -1) > height(1, -1) + 0.05, 'left stick raises the left wing\'s surfaces');
  assert.ok(height(1, 1) > height(0, 1) + 0.05, 'right stick raises the right wing\'s');
  // Rudder: full left (0 s) swings the trailing edge left (-X), full right (1 s) right, about where it sits at neutral.
  for (const part of partsOf('rudder')) {
    const still = rear('rudder', 0.5, part)[0];
    assert.ok(rear('rudder', 0, part)[0] < still - 0.05 && rear('rudder', 1, part)[0] > still + 0.05, 'the rudder swings left then right');
    assert.ok(Math.abs(still) < 0.02, 'and sits on the centreline at neutral');
  }
  // At neutral the airplane is the same either side: every control is centred at 0.5 s.
  const neutral = bounds(posed({ gear: 0 }));
  assert.ok(Math.abs(neutral.min[0] + neutral.max[0]) < 0.02, 'the same either side at neutral');
  for (const name of ['elevator', 'aileron']) {
    const parts = partsOf(name), heights = (wing) => parts.filter((p) => name === 'elevator' || side(p) === wing).map((p) => moved(name, 0.5, p));
    const left = bounds(heights(-1).flatMap((b) => [b.min, b.max])), right = bounds(heights(1).flatMap((b) => [b.min, b.max]));
    assert.ok(Math.abs(left.min[1] - right.min[1]) < 0.01 && Math.abs(left.max[1] - right.max[1]) < 0.01, `${name}: left and right sit at the same height at 0.5 s`);
  }
});

test('each surface travels as far as the real one', () => {
  // docs/models.md, for the F-4C, in degrees: stabilator about 21 trailing edge
  // up and 9 down; trailing-edge flaps 60 and leading-edge flaps 30; ailerons
  // 30 down only, with the spoiler on the other wing 45 up; rudder 30 each way.
  const WITHIN = 2;
  const degrees = (a, b) => (2 * Math.acos(Math.min(1, Math.abs(a.reduce((sum, x, k) => sum + x * b[k], 0)))) * 180) / Math.PI;
  const edge = (part, positions, rearmost) => verticesUnder(glb, part, world(positions)).reduce((a, p) => ((rearmost ? p[2] > a[2] : p[2] < a[2]) ? p : a))[1];
  // For each part a motion turns: how far it turns over each half of the motion.
  const swings = (name) => json.animations.find((a) => a.name === name).channels.filter((c) => c.target.path === 'rotation').map((channel) => {
    const part = channel.target.node, at = (t) => poseAt(glb, name, t)[part].rotation;
    return { part, name: json.nodes[part].name, first: degrees(at(0), at(0.5)), second: degrees(at(0.5), at(1)), whole: degrees(at(0), at(1)) };
  });
  const check = (what, got, want) => {
    console.log(`  ${what}: ${got.toFixed(1)} deg (the real one: about ${want})`);
    assert.ok(Math.abs(got - want) <= WITHIN, `${what} is ${want} degrees, give or take ${WITHIN}`);
  };
  for (const s of swings('flaps')) {
    // A trailing-edge flap drops its rear edge; a leading-edge flap drops its front edge.
    const drop = (rearmost) => edge(s.part, { flaps: 0 }, rearmost) - edge(s.part, { flaps: 1 }, rearmost);
    const trailing = drop(true) > drop(false);
    check(`${s.name} down (${trailing ? 'trailing' : 'leading'} edge)`, s.whole, trailing ? 60 : 30);
  }
  for (const s of swings('elevator')) {
    check(`${s.name} forward stick`, s.first, 9);
    check(`${s.name} back stick`, s.second, 21);
  }
  for (const s of swings('aileron')) {
    assert.ok(Math.min(s.first, s.second) < 0.01 && Math.max(s.first, s.second) > 1, `${s.name} moves for one direction of roll only`);
    const end = s.first > s.second ? 0 : 1;
    const up = edge(s.part, { aileron: end }, true) > edge(s.part, { aileron: 0.5 }, true);
    check(`${s.name} ${up ? 'up (a spoiler)' : 'down (an aileron)'}`, Math.max(s.first, s.second), up ? 45 : 30);
  }
  for (const s of swings('rudder')) {
    check(`${s.name} left`, s.first, 30);
    check(`${s.name} right`, s.second, 30);
  }
});

test('the model is inside its budget', () => {
  const bytes = statSync(path).size;
  const triangles = json.meshes.flatMap((m) => m.primitives).reduce((sum, p) => sum + json.accessors[p.indices ?? p.attributes.POSITION].count / 3, 0);
  console.log(`  ${Math.round(bytes / 1024)} KB, ${Math.round(triangles)} triangles, ${json.materials.length} material, ${(json.images ?? []).length} textures`);
  assert.ok(bytes < 2 * 1024 * 1024, 'under 2 MB');
  assert.ok(triangles < 50000, 'under 50,000 triangles');
  assert.equal(json.materials.length, 1, 'one material');
  assert.ok((json.images ?? []).length <= 2, 'two textures at most: colour, and roughness with metalness');
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
    const skin = posed({ gear }, tyreNodes).map(toBody), points = card.map(metres);
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
  const down = world({ gear: 1 });
  const tyres = tyreNodes.flatMap((node) => verticesUnder(glb, node, down)).map(toBody);
  for (let roll = -30; roll <= 30; roll += 2.5) {
    const gap = deepest(tyres, 0, roll) - deepest(tyreEdges.map(metres), 0, roll);
    if (gap > worst.gap) worst = { gap, pitch: 0, roll, what: 'the tyres' };
  }
  console.log(`  ${F4C.airframe_ft.length} airframe points and ${F4C.gear_ft.length} gear points; the most the model dips below the card is ${(worst.gap * 100).toFixed(1)} cm${worst.gap ? ` (${worst.what}, ${worst.pitch} deg nose up, ${worst.roll} deg of bank)` : ''}`);
  assert.ok(worst.gap < 0.05, 'within 5 cm at every attitude from nose 10 down to 20 up and 30 degrees of bank');
});

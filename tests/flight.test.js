// The app's own flight plumbing, headless: the field, the axes between the
// simulation and the picture, and the fixed-step loop's arithmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCard, FT, DEG } from '../src/sim/card.js';
import { F4C } from '../src/sim/cards/f4c.js';
import { Sim, DT, stepsFor } from '../src/sim/sim.js';
import { qfromEuler, qrotate, qtoEuler } from '../src/sim/vec.js';
import { FIELD, PARKED, fieldGround, startState } from '../src/field.js';
import { fly } from './fly.js';
import { readouts } from '../src/readouts.js';
import { circuit } from './circuit.js';
import { attitudeToThree, toThree } from '../src/render/frames.js';

const near = (a, b, tolerance, what) => assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);

test('at the start the jet sits still on its wheels on the runway numbers, pointing down the runway', () => {
  const card = deriveCard(F4C);
  const sim = new Sim(card, startState(card), { ground: fieldGround(), gear: true, flaps: true });
  for (let i = 0; i < 5 / DT; i++) sim.step(PARKED);
  const settled = { x: [...sim.state.x], euler: qtoEuler(sim.state.q) };
  for (let i = 0; i < 30 / DT; i++) sim.step(PARKED);
  const moved = Math.hypot(...sim.state.x.map((x, i) => x - settled.x[i]));
  const euler = qtoEuler(sim.state.q);
  const ahead = (FIELD.runway.length / 2 - sim.state.x[0]) / FT;
  console.log(`  parked for 30 s: moves ${(moved / FT).toFixed(2)} ft, heading ${(euler.yaw / DEG).toFixed(2)}, nose ${(euler.pitch / DEG).toFixed(1)} deg, ${Math.round(ahead)} ft of runway ahead`);
  assert.equal(sim.crashed, null, 'no crash');
  assert.ok(moved < 0.3, 'it stays put on the brakes');
  assert.deepEqual(sim.touching.slice(0, 3), [true, true, true], 'all three wheels are on the ground');
  near(euler.yaw, 0, 0.5 * DEG, 'heading north');
  near(euler.roll, 0, 0.5 * DEG, 'wings level');
  near(sim.state.x[1], 0, 0.1, 'on the centreline');
  assert.ok(ahead > 9700 && ahead < 10000, 'nearly all of the 10,000 ft ahead');
});

test('the axes: north, east and up in the simulation land where the picture expects', () => {
  assert.deepEqual(toThree([1, 0, 0]), [0, -0, -1], 'north is -z');
  assert.deepEqual(toThree([0, 1, 0]), [1, -0, -0], 'east is +x');
  assert.deepEqual(toThree([0, 0, -1]), [0, 1, -0], 'up is +y');
  // An attitude goes across so that the model's nose, right wing and top
  // point where the airplane's do. Rotate with the picture's quaternion by hand.
  const rotate = ([x, y, z, w], v) => qrotate([w, x, y, z], v);
  for (const [roll, pitch, yaw] of [[0, 0, 0], [0, 0, 90], [0, 30, 0], [60, 0, 0], [40, -20, 250], [-170, 80, 10]]) {
    const q = qfromEuler(roll * DEG, pitch * DEG, yaw * DEG), t = attitudeToThree(q);
    const pairs = [[[1, 0, 0], [0, 0, -1], 'nose'], [[0, 1, 0], [1, 0, 0], 'right wing'], [[0, 0, -1], [0, 1, 0], 'top']];
    for (const [body, model, name] of pairs) {
      const want = toThree(qrotate(q, body)), got = rotate(t, model);
      for (let i = 0; i < 3; i++) near(got[i], want[i], 1e-12, `${name} at roll ${roll}, pitch ${pitch}, heading ${yaw}`);
    }
  }
});

test('the loop takes fixed steps: none are lost, and a long frame is cut short', () => {
  // A minute of frames at 60, 30 and 120 a second all take a minute of steps.
  for (const fps of [60, 30, 120]) {
    let carry = 0, steps = 0;
    for (let i = 0; i < 60 * fps; i++) {
      const s = stepsFor(carry, 1 / fps);
      assert.ok(s.fraction >= 0 && s.fraction < 1, 'the picture is between the last two steps');
      carry = s.carry; steps += s.steps;
    }
    near(steps * DT, 60, DT, `${fps} frames a second`);
  }
  const long = stepsFor(0, 0.25);
  assert.equal(long.steps, 8, 'a quarter-second frame takes 8 steps, not 30');
  assert.ok(long.carry < DT, 'and the rest is dropped');
});

test('a whole flight through the controls the app gives the player: take off, fly a circuit, land and stop on the runway', () => {
  const card = deriveCard(F4C);
  const sim = new Sim(card, startState(card), { ground: fieldGround(), gear: true, flaps: true });
  for (let t = 0; t < 3; t += DT) sim.step(PARKED);   // as the app does before a flight
  const pilot = circuit(), released = sim.t;
  const log = fly(sim, 480, pilot, 1);
  const e = pilot.events, half = FIELD.runway.length / 2, edge = FIELD.runway.width / 2;
  assert.equal(sim.crashed, null, 'no crash');
  for (const name of ['liftoff', 'base', 'flare', 'touchdown', 'stopped']) assert.ok(e[name], `the flight reached: ${name}`);
  const along = (m) => Math.round((m + half) / FT);   // feet from the south end of the runway
  const highest = Math.max(...log.map((r) => r.ft)), fastest = Math.max(...log.map((r) => r.kias));
  console.log(`  lifts off at ${e.liftoff.kias.toFixed(0)} kt, ${along(e.liftoff.north)} ft down the runway, ${(e.liftoff.t - released).toFixed(0)} s after brake release`);
  console.log(`  circuit: up to ${Math.round(highest)} ft and ${Math.round(fastest)} kt, ${(Math.max(...log.map((r) => r.east)) / 1852).toFixed(1)} nm wide; turns final ${(-(e.base.north + half) / 1852).toFixed(1)} nm out`);
  console.log(`  touches down at ${e.touchdown.kias.toFixed(0)} kt, ${along(e.touchdown.north)} ft past the threshold, ${Math.abs(e.touchdown.east / FT).toFixed(0)} ft off the centreline`);
  console.log(`  stops ${along(e.stopped.north)} ft down the runway, ${Math.round((e.stopped.north - e.touchdown.north) / FT)} ft after touchdown; the flight took ${((e.stopped.t - released) / 60).toFixed(1)} min`);
  assert.ok(Math.abs(e.liftoff.north) < half, 'it lifts off before the end of the runway');
  for (const name of ['touchdown', 'stopped']) {
    assert.ok(Math.abs(e[name].north) < half && Math.abs(e[name].east) < edge, `${name} is on the runway`);
  }
  assert.ok(e.touchdown.north < 0, 'it touches down in the first half');
  assert.ok(log.every((r) => !r.onGround || Math.abs(r.east) < edge), 'it never leaves the runway on the ground');
});

test('readouts: knots and feet, with radar altitude only below 2,000 ft above the ground', () => {
  assert.deepEqual(readouts(0, -0.4, -0.4), { airspeed: '0', altitude: '0', radar: 'R 0' }, 'on the runway everything reads zero');
  assert.deepEqual(readouts(349.6, 12344, 9000), { airspeed: '350', altitude: '12,340', radar: '' }, 'high up: no radar altitude');
  assert.equal(readouts(300, 5000, 2000).radar, '', 'none at exactly 2,000 ft');
  assert.equal(readouts(300, 5000, 1996).radar, 'R 2,000', 'just below, it appears, to the nearest 10 ft');
  assert.equal(readouts(150, 3237, 237).radar, 'R 240');
  assert.equal(readouts(150, 3047.4, 47.4).radar, 'R 47', 'below 100 ft, to the foot');
  assert.equal(readouts(150, 3047.4, 47.4).altitude, '3,050', 'over high ground the two differ');
});

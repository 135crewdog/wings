// The app's own flight plumbing, headless: the field, the axes between the
// simulation and the picture, and the fixed-step loop's arithmetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deriveCard, FT, DEG } from '../src/sim/card.js';
import { F4C } from '../src/sim/cards/f4c.js';
import { Sim, DT, stepsFor } from '../src/sim/sim.js';
import { qfromEuler, qrotate, qtoEuler } from '../src/sim/vec.js';
import { FIELD, fieldGround, startState } from '../src/field.js';
import { attitudeToThree, toThree } from '../src/render/frames.js';

const near = (a, b, tolerance, what) => assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);

test('at the start the jet sits still on its wheels on the runway numbers, pointing down the runway', () => {
  const card = deriveCard(F4C);
  const sim = new Sim(card, startState(card), { ground: fieldGround(), gear: true, flaps: true });
  const parked = { throttle: 0, gear: true, flaps: true, brake: true };
  for (let i = 0; i < 5 / DT; i++) sim.step(parked);
  const settled = { x: [...sim.state.x], euler: qtoEuler(sim.state.q) };
  for (let i = 0; i < 30 / DT; i++) sim.step(parked);
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

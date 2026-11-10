// The pilot's controls, headless: phone tilt to stick, and the throttle slider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAPPING, smooth, stickFrom, tiltOf, upInScreen } from '../src/input/tilt.js';
import { positionFromThrottle, throttleFromPosition } from '../src/ui/throttle.js';
import { MIL_THROTTLE, powerWanted } from '../src/sim/engine.js';

const D = Math.PI / 180;
const near = (a, b, tolerance, what) => assert.ok(Math.abs(a - b) <= tolerance, `${what}: ${a} vs ${b}`);

// What the phone's sensor reads (beta, gamma in degrees) when "up" lies along
// (x, y, z) in the phone's own directions: x to its right edge, y to its top
// edge, z out of the screen. From the sensor's definition (W3C DeviceOrientation).
function sensor([x, y, z]) {
  for (const beta of [Math.asin(y), Math.PI - Math.asin(y)]) {
    const c = Math.cos(beta);
    if (Math.abs(c) < 1e-9) return { beta: beta / D, gamma: 0 };
    if (z / c >= -1e-12) return { beta: beta / D, gamma: Math.atan2(-x / c, z / c) / D };
  }
  throw new Error('no reading');
}

// A phone held in landscape like a steering wheel, the screen turned
// `screenAngle` from portrait, tipped `back` degrees (top edge toward the
// pilot) and turned `clockwise` degrees as the pilot sees it. Returns the tilt.
function held(screenAngle, back, clockwise) {
  // "Up" as seen on the screen: turning the wheel clockwise swings it anticlockwise;
  // tipping the top edge toward the pilot points it into the screen.
  const onScreen = [-Math.sin(clockwise * D) * Math.cos(back * D), Math.cos(clockwise * D) * Math.cos(back * D), -Math.sin(back * D)];
  // The same direction in the phone's own axes: undo the screen's turn.
  const t = -screenAngle * D, c = Math.cos(t), s = Math.sin(t);
  const { beta, gamma } = sensor([c * onScreen[0] - s * onScreen[1], s * onScreen[0] + c * onScreen[1], onScreen[2]]);
  return tiltOf(upInScreen(beta, gamma, screenAngle));
}

test('tilt: top edge toward you is back stick, clockwise is right stick, in both landscapes', () => {
  for (const angle of [90, 270]) {
    const neutral = held(angle, -15, 0);   // held with the screen leaning back 15 degrees, as on a lap
    const at = (back, clockwise) => stickFrom(held(angle, -15 + back, clockwise), neutral);
    for (const axis of ['pitch', 'roll']) {
      assert.ok(at(0, 0)[axis] === 0, 'at neutral the stick is centred');
      assert.ok(at(1.5, -1)[axis] === 0, 'a small wobble does nothing');
    }
    assert.ok(at(10, 0).pitch > 0 && at(-10, 0).pitch < 0, 'top edge toward you pulls; away pushes');
    assert.ok(at(0, 10).roll > 0 && at(0, -10).roll < 0, 'clockwise is right; anticlockwise is left');
    near(at(MAPPING.pitchFull, 0).pitch, 1, 1e-9, `full back stick at ${MAPPING.pitchFull} degrees`);
    near(at(60, 0).pitch, 1, 1e-9, 'and no more beyond it');
    near(at(0, MAPPING.rollFull).roll, 1, 1e-9, `full right stick at ${MAPPING.rollFull} degrees`);
    near(at(13.5, 0).pitch, 0.5, 1e-9, 'half back stick half way between the dead spot and full');
    near(at(8, 0).roll, 0, 1e-9, 'tipping the phone does not roll');
    near(at(0, 12).pitch, 0, 1e-9, 'turning the phone does not pitch');
  }
  console.log(`  full stick at ${MAPPING.pitchFull} deg of pitch and ${MAPPING.rollFull} deg of roll; dead spot ${MAPPING.pitchDeadband} and ${MAPPING.rollDeadband} deg`);
});

test('tilt: roll fades out as the screen comes to face straight up, and smoothing settles', () => {
  const neutral = held(90, -15, 0);
  const upright = stickFrom(held(90, -15, 20), neutral).roll, flat = stickFrom(held(90, -85, 20), neutral).roll;
  assert.ok(upright > 0.6 && Math.abs(flat) < upright / 2, 'less roll when the phone is nearly flat');
  let x = 0;
  for (let i = 0; i < 10; i++) x = smooth(x, 1, 1 / 60);
  assert.ok(x > 0.99 && x <= 1, 'a sixth of a second after a move the stick is there');
  assert.equal(smooth(0.3, 1, 0), 1, 'with no time between readings, the new one is used');
});

test('throttle: idle at the bottom, exactly MIL around the mark, full afterburner at the top', () => {
  assert.equal(throttleFromPosition(0), 0, 'bottom is idle');
  assert.equal(throttleFromPosition(1), 1, 'top is full afterburner');
  assert.equal(throttleFromPosition(-0.2), 0);
  assert.equal(throttleFromPosition(1.2), 1);
  const mark = positionFromThrottle(MIL_THROTTLE);
  for (const p of [mark - 0.05, mark, mark + 0.05]) assert.equal(powerWanted(throttleFromPosition(p)), 1, 'a finger near the mark gets exactly MIL');
  let last = -1;
  for (let p = 0; p <= 1.0001; p += 0.01) {
    const t = throttleFromPosition(p);
    assert.ok(t >= last, 'pushing the slider up never reduces the throttle');
    last = t;
    if (t !== MIL_THROTTLE) near(positionFromThrottle(t), p, 1e-9, 'the thumb sits under the finger');
  }
  assert.ok(powerWanted(throttleFromPosition(mark - 0.07)) < 1, 'below the band is less than MIL');
  assert.ok(powerWanted(throttleFromPosition(mark + 0.09)) > 1, 'above the band the afterburner lights');
  console.log(`  MIL mark ${Math.round(mark * 100)}% of the way up; the afterburner is the top ${Math.round((1 - 0.8) * 100)}%`);
});

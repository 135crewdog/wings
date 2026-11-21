// The HUD, headless: what it writes, and the readings it is drawn from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apexFor, headingText, powerText, magnetic, tapeMarks, cueDirection, relativeBearing, steerText, numberPlaces, bankTickAngle, BANK_TICKS } from '../src/hud.js';
import { instruments } from '../src/sim/airdata.js';
import { airborne, card, fly } from './fly.js';

test('the HUD writes heading, power and the apex symbols as a fighter HUD does', () => {
  assert.equal(headingText(0), '000');
  assert.equal(headingText(-90), '270');
  assert.equal(headingText(359.6), '000');
  assert.equal(headingText(85), '085');
  assert.equal(powerText(0), 'IDLE');
  assert.equal(powerText(0.62), '62%');
  assert.equal(powerText(1), 'MIL');
  assert.equal(powerText(1.5), 'AB 50%');
  assert.equal(powerText(2), 'AB 100%');
  assert.equal(apexFor(0), null);
  assert.equal(apexFor(80), 'zenith');
  assert.equal(apexFor(-80), 'nadir');
});

test('the heading tape reads magnetic, War Wagon style', () => {
  // 8R at Honolulu points 090 true; with Hawaii's 9.6 degrees east it reads 080.
  assert.equal(headingText(magnetic(90)), '080');
  assert.equal(headingText(magnetic(5)), '355');
  const marks = tapeMarks(80.4, 14, 190);
  assert.ok(marks.every((m) => Math.abs(m.x) >= 8 && Math.abs(m.x) <= 190), 'nothing under the pointer, nothing past the tape');
  assert.ok(marks.every((m) => !m.label || Math.abs(m.x) > 30), 'no number under the readout');
  assert.deepEqual(marks.filter((m) => m.label).map((m) => m.label), ['07', '09'], 'the tens either side, the 08 under the readout left out');
});

test('the airspeed and altitude mirror each other, and the horizon line stops short of both', () => {
  // iPhone 16 in landscape: 852 points wide, a 59-point safe-area inset each
  // side, the HUD's edges 84 in from the left (the throttle) and 170 in from
  // the right (the buttons).
  const cx = 426, left = 59 + 84, right = 852 - 59 - 170;
  const at = numberPlaces(cx, left, right);
  assert.equal(cx - at.airspeed, at.altitude - cx, 'the same distance either side of the middle');
  assert.equal(at.altitude, right - 42, 'the altitude stays where the buttons let it, 155 points out');
  assert.ok(at.horizon < at.out && at.horizon > at.out - 30, `the horizon line ends a little short of the numbers (${at.horizon} of ${at.out})`);
  // A screen where the throttle is the tighter side: the airspeed decides.
  const tight = numberPlaces(300, 120, 560);
  assert.equal(tight.airspeed, 120 + 42, 'the airspeed never goes under the throttle');
  assert.equal(300 - tight.airspeed, tight.altitude - 300);
});

test('the bank scale reads the Boeing way, on the banked side', () => {
  assert.deepEqual(BANK_TICKS, [-45, -30, -20, -10, 0, 10, 20, 30, 45], '0, 10, 20, 30 and 45 each side');
  assert.equal(bankTickAngle(0, 0), 0, 'level: the zero tick under the pointer');
  // In a 30-degree right bank the horizon turns 30 degrees anticlockwise on
  // the glass, and so does the arc: the right-hand 30 tick comes under the
  // pointer, which stays straight up with the jet.
  assert.equal(bankTickAngle(30, -30), 0);
  assert.equal(bankTickAngle(0, -30), -30, 'the zero tick has gone 30 degrees to the left');
  assert.equal(bankTickAngle(-45, 45), 0, 'a 45-degree left bank: the left-hand 45 tick under the pointer');
});

test('the steerpoint: which way to turn, and how far', () => {
  assert.equal(relativeBearing(80, 100), 20);
  assert.equal(relativeBearing(350, 10), 20, 'across north');
  assert.equal(relativeBearing(10, 350), -20);
  assert.deepEqual(cueDirection({ visible: false }, { x: 0, y: 0 }, -90), { x: -1, y: 0 }, 'behind and to the left: the tail points left');
  const up = cueDirection({ visible: true, x: 100, y: 0 }, { x: 100, y: 100 }, 0);
  assert.ok(Math.abs(up.y + 1) < 1e-9, 'in view: the tail points at it');
  assert.equal(steerText(12.44, 'HNL'), '12.4 > HNL');
});

test('its readings: level flight is 1 g, the nose and the flight path agree, a climb points up', () => {
  const sim = airborne(card(), { ft: 10000, kt: 350, level: true, throttle: 'trim' });
  const level = instruments(sim, sim.observe({ elevator: sim.trim.elevator }));
  assert.ok(Math.abs(level.g - 1) < 0.02, `level flight reads 1 g (${level.g.toFixed(2)})`);
  assert.ok(Math.abs(level.alpha - level.pitch) < 0.01, 'level, the nose is above the flight path by the angle of attack');
  assert.ok(Math.abs(level.velocity[2]) < 0.01 && level.nose[2] < 0, 'the flight path is on the horizon and the nose above it');
  assert.ok(Math.abs(level.heading) < 0.01, 'heading north');
  assert.ok(level.up[2] < -0.99, "level, the jet's own up is straight up");
  fly(sim, 3, () => ({ elevator: 0.4, throttle: 1 }));
  const climbing = instruments(sim, sim.observe({ elevator: 0.4 }));
  assert.ok(climbing.velocity[2] < -0.05 && climbing.g > 1.5, `pulling up, the flight path climbs and the g builds (${climbing.g.toFixed(1)} g)`);
});

test('the pause screen has the HUD and developer switches beside crash override, kept as wings.hud and wings.dev', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const pause = page.slice(page.indexOf('id="screen-pause"'), page.indexOf('id="screen-crashed"'));
  assert.ok(pause.includes('id="override"') && pause.includes('id="hud-switch"') && pause.includes('id="dev-switch"'), 'all three switches are on the pause screen');
  assert.ok(main.includes("'wings.hud'") && main.includes("'wings.dev'"), 'the choices are kept under wings. keys');
});

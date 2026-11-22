// The HUD, headless: what it writes, and the readings it is drawn from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apexFor, headingText, powerText, magnetic, tapeMarks, tapeX, focalLength, viewHeading, cueDirection, relativeBearing, steerText, numberPlaces, bankTickAngle, BANK_TICKS, longBankTick } from '../src/hud.js';
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
  const marks = tapeMarks(80.4, 802, 190);
  assert.ok(marks.every((m) => Math.abs(m.x) >= 8 && Math.abs(m.x) <= 190), 'nothing under the pointer, nothing past the tape');
  assert.ok(marks.every((m) => !m.label || Math.abs(m.x) > 30), 'no number under the readout');
  assert.deepEqual(marks.filter((m) => m.label).map((m) => m.label), ['07', '09'], 'the tens either side, the 08 under the readout left out');
});

// iPhone 16 in landscape, 852 by 393 points, the chase camera's 55-degree
// view: the tape reaches 22% of the width either side of the middle.
const IPHONE = { w: 852, h: 393 }, FOCAL = focalLength(55, IPHONE.h), REACH = IPHONE.w * 0.22;

test('each heading on the tape sits over its own direction on the horizon', async () => {
  // Three.js's own camera, as the view is drawn: a direction on the horizon
  // some degrees right of where the camera looks lands where tapeX puts it.
  const THREE = await import('../vendor/three/build/three.module.js');
  const camera = new THREE.PerspectiveCamera(55, IPHONE.w / IPHONE.h, 1, 1000);
  camera.updateMatrixWorld();
  for (const right of [-40, -25, -10, 5, 20, 35]) {
    const r = right * Math.PI / 180, p = new THREE.Vector3(Math.sin(r), 0, -Math.cos(r)).project(camera);
    const x = (p.x * IPHONE.w) / 2;
    assert.ok(Math.abs(x - tapeX(right, FOCAL)) < 0.01, `${right} deg right: ${x.toFixed(2)} px on the view, ${tapeX(right, FOCAL).toFixed(2)} on the tape`);
  }
  assert.equal(tapeX(100, FOCAL), null, 'nothing for a heading behind the view');
});

test('the tape follows the view, and the pointer stays with the nose', () => {
  const labels = (marks) => marks.filter((m) => m.label).map((m) => `${m.label}${m.x > 0 ? ' right' : ' left'}`);
  // Not swung, flying 080: the pointer in the middle, the tens either side, as before.
  assert.equal(tapeX(0, FOCAL), 0);
  assert.deepEqual(labels(tapeMarks(80, FOCAL, REACH, 0)), ['06 left', '07 left', '09 right', '10 right']);
  // Flying north, the view swung 70 degrees right: the tape is centred on 070
  // and 090 is over the right side of the view. The nose is 70 degrees left,
  // off the tape, so the pointer has gone with it.
  const yaw = -70, pointer = tapeX(yaw, FOCAL);
  assert.ok(Math.abs(pointer) > REACH + 30, 'the pointer is off the end of the tape');
  const swung = tapeMarks(0 - yaw, FOCAL, REACH, null);
  assert.deepEqual(labels(swung), ['05 left', '06 left', '07 left', '08 right', '09 right']);
  const nine = swung.find((m) => m.label === '09');
  assert.ok(Math.abs(nine.x - tapeX(20, FOCAL)) < 1e-9, '090 sits 20 degrees right of the middle, where the horizon has it');
  // Swung 15 degrees right: the pointer and readout have moved left with the
  // nose, still on the tape, and the numbers under the readout are left out there.
  const near = tapeX(-15, FOCAL), marks = tapeMarks(15, FOCAL, REACH, near);
  assert.ok(near < -90 && near > -REACH, `the pointer ${near.toFixed(0)} px left of the middle`);
  assert.ok(marks.every((m) => Math.abs(m.x - near) >= 8 && (!m.label || Math.abs(m.x - near) > 30)), 'clear of the pointer and readout wherever they are');
  assert.ok(labels(marks).includes('02 right'), 'the middle and right of the tape read on as usual');
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
  assert.deepEqual(BANK_TICKS, [-90, -60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60, 90], '0, 10, 20, 30, 45, 60 and 90 each side');
  assert.deepEqual(BANK_TICKS.filter(longBankTick), [-90, -60, -45, -30, 0, 30, 45, 60, 90], 'long at 0, 30, 45, 60 and 90; short at 10 and 20');
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

test('in a bank, the tape follows where the swung view really looks', async () => {
  const near = (a, b, what) => assert.ok(Math.abs(a - b) < 0.05, `${what}: ${a.toFixed(2)}, expected ${b.toFixed(2)}`);
  near(viewHeading(0, 0, 0), 0, 'not swung');
  near(viewHeading(0, 0, -15), 15, 'wings level, swung 15 degrees right: 15 degrees of heading');
  near(viewHeading(0, 0, 40, -20), -40, 'wings level, swung left and down: 40 left');
  near(viewHeading(0, 90, -30), 0, 'in a 90-degree right bank, swinging right looks down, not round');
  // Against three.js's own rotations, as the chase camera turns the view:
  // the jet's attitude, then the swing about its own axes (src/render/camera.js).
  const THREE = await import('../vendor/three/build/three.module.js');
  const D = Math.PI / 180;
  for (const [pitch, roll, yaw, look] of [[0, 60, -15, 0], [10, -45, 30, 10], [-20, 120, -60, -25], [35, 30, 90, 0]]) {
    const jet = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch * D, 0, -roll * D, 'YXZ'));   // heading north: three's axes, x east, y up, -z north
    const swing = new THREE.Quaternion().setFromEuler(new THREE.Euler(look * D, yaw * D, 0, 'YXZ'));
    const ahead = new THREE.Vector3(0, 0, -1).applyQuaternion(jet.multiply(swing));
    near(viewHeading(pitch, roll, yaw, look), Math.atan2(ahead.x, -ahead.z) / D, `pitch ${pitch}, bank ${roll}, swung ${yaw}/${look}`);
  }
});

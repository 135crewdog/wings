// The HUD, headless: what it writes, and the readings it is drawn from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { apexFor, headingText, powerText } from '../src/hud.js';
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

test('its readings: level flight is 1 g, the nose and the flight path agree, a climb points up', () => {
  const sim = airborne(card(), { ft: 10000, kt: 350, level: true, throttle: 'trim' });
  const level = instruments(sim, sim.observe({ elevator: sim.trim.elevator }));
  assert.ok(Math.abs(level.g - 1) < 0.02, `level flight reads 1 g (${level.g.toFixed(2)})`);
  assert.ok(Math.abs(level.alpha - level.pitch) < 0.01, 'level, the nose is above the flight path by the angle of attack');
  assert.ok(Math.abs(level.velocity[2]) < 0.01 && level.nose[2] < 0, 'the flight path is on the horizon and the nose above it');
  assert.ok(Math.abs(level.heading) < 0.01, 'heading north');
  fly(sim, 3, () => ({ elevator: 0.4, throttle: 1 }));
  const climbing = instruments(sim, sim.observe({ elevator: 0.4 }));
  assert.ok(climbing.velocity[2] < -0.05 && climbing.g > 1.5, `pulling up, the flight path climbs and the g builds (${climbing.g.toFixed(1)} g)`);
});

test('the pause screen has the HUD switch beside crash override, kept as wings.hud', () => {
  const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  const pause = page.slice(page.indexOf('id="screen-pause"'), page.indexOf('id="screen-crashed"'));
  assert.ok(pause.includes('id="override"') && pause.includes('id="hud-switch"'), 'both switches are on the pause screen');
  assert.ok(main.includes("'wings.hud'"), 'the choice is kept under a wings. key');
});

// The F-4C's checkride: maneuvers flown headless through Sim.step(), with the
// results in knots, feet, degrees and g next to the card's numbers. Card
// numbers are graded within the tolerances of the milestone 1 plan (stall
// speeds +-5 knots, top speeds +-5%, g limit and roll rate +-10%), each from
// the pull request that builds what it measures. Feel numbers are only
// reported.
//
// So far: the core flies, with a placeholder lift curve, no engine and
// placeholder control powers. Nothing is graded against the card yet.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, airborne, fly, readout, table, KT, FT, DEG, DT } from './fly.js';
import { Sim, finite, MAX_RATE } from '../src/sim/sim.js';
import { atmosphere } from '../src/sim/atmosphere.js';

const round = (x, n = 0) => Number(x.toFixed(n));

test('the card derives into sensible numbers', () => {
  const c = card();
  table('F-4C, derived from the card', [
    ['weight', `${round(c.m)} kg`, `${c.pilot.weight_lb} lb`],
    ['aspect ratio', round(c.AR, 2)],
    ['max lift coefficient', round(c.CLmax, 2), `from the ${c.pilot.stall_clean_kt} kt stall`],
    ['stall angle of attack', `${round(c.alphaStall / DEG, 1)} deg`],
    ['corner speed', `${round(c.vCorner / KT)} kt`, `stall x sqrt(${c.gLimit} g)`],
  ]);
  // At the stall speed, in level flight at sea level, the most lift the wing makes is the weight.
  const lift = 0.5 * atmosphere(0).rho * c.vStall ** 2 * c.S * c.CLmax;
  assert.ok(Math.abs(lift / c.W - 1) < 1e-9, 'max lift at the stall speed equals weight');
  assert.ok(c.alphaStall > 10 * DEG && c.alphaStall < 30 * DEG, 'stall angle of attack is believable');
  assert.ok(c.I.every((i) => i > 0));
});

test('the same flight twice gives the same result', () => {
  const run = () => {
    const sim = airborne(card());
    fly(sim, 20, (r) => ({ elevator: 0.3 * Math.sin(r.t), aileron: 0.5 * Math.cos(2 * r.t) }));
    return sim.state;
  };
  assert.deepEqual(run(), run());
});

test('hands off, it glides and settles near the neutral speed', () => {
  const c = card();
  const sim = airborne(c, { ft: 30000, kt: 350 * Math.sqrt(atmosphere(0).rho / atmosphere(30000 * FT).rho) });
  const log = fly(sim, 240);
  // Indicated speed: what the airspeed needle would show, true speed scaled by air density.
  const indicated = (r) => r.kt * Math.sqrt(atmosphere(r.ft * FT).rho / atmosphere(0).rho);
  const late = log.filter((r) => r.t >= 180);
  const kias = late.map(indicated);
  const mean = kias.reduce((a, b) => a + b) / kias.length;
  const end = log.at(-1), start = late[0];
  const glideRatio = (end.north - start.north) / ((start.ft - end.ft) * FT);
  table('Glide, hands off, no engine, from 30,000 ft', [
    ['indicated speed, last minute', `${round(mean)} kt`, `${c.pilot.neutral_speed_kt} kt neutral speed (not graded)`],
    ['speed wander, last minute', `${round(Math.max(...kias) - Math.min(...kias))} kt`],
    ['glide ratio', `${round(glideRatio, 1)} : 1`],
    ['descent rate', `${round(-end.fpm)} ft/min`],
    ['altitude after 4 minutes', `${round(end.ft)} ft`],
  ]);
  assert.equal(sim.crashed, null);
  assert.ok(Math.abs(end.roll) < 5, 'wings stay level hands off');
  assert.ok(glideRatio > 3 && glideRatio < 20, 'it glides like an airplane');
});

test('aerobatics and abuse all end with a real state', () => {
  const c = card();
  const rows = [];
  const check = (name, sim, seconds, controls, note) => {
    const log = fly(sim, seconds, controls, 0.05);
    assert.equal(sim.crashed, null, `${name}: the flight did not break`);
    assert.ok(finite(sim.state), `${name}: the state is finite`);
    assert.ok(sim.state.omega.every((w) => Math.abs(w) <= MAX_RATE), `${name}: body rates are bounded`);
    rows.push([name, note(log)]);
    return log;
  };

  // A loop: hold back stick until the nose has come all the way round. With no
  // engine yet it runs out of speed over the top and falls through; that still
  // has to end with a real state.
  let turned = 0;
  check('loop, no engine', airborne(c, { ft: 15000, kt: 450 }), 40, (r, sim) => {
    turned += sim.state.omega[1] * DT;
    return { elevator: turned < 2 * Math.PI ? 0.6 : 0 };
  }, (log) => `${round(turned / DEG)} deg of pitch travel, top g ${round(Math.max(...log.map((r) => r.g)), 1)}, slowest ${round(Math.min(...log.map((r) => r.kt)))} kt`);

  // A roll: full right stick for four seconds.
  check('roll', airborne(c, { ft: 15000, kt: 400 }), 4, () => ({ aileron: 1 }),
    (log) => `peak ${round(Math.max(...log.map((r) => r.rollRate)))} deg/s`);

  // Inverted: start upside down and hold a little forward stick.
  check('inverted', airborne(c, { ft: 15000, kt: 400, roll: 180 }), 15, () => ({ elevator: -0.3 }),
    (log) => `ends at ${round(log.at(-1).ft)} ft, ${round(log.at(-1).kt)} kt`);

  // A spin attempt: slow, full back stick, full rudder and aileron, held for 30 seconds.
  check('spin attempt', airborne(c, { ft: 30000, kt: 180, pitch: 20 }), 30, () => ({ elevator: 1, aileron: 1, rudder: 1 }),
    (log) => `peak roll rate ${round(Math.max(...log.map((r) => Math.abs(r.rollRate))))} deg/s, peak angle of attack ${round(Math.max(...log.map((r) => Math.abs(r.alpha))))} deg`);

  // Thrown: tumbling at the rate limit on every axis.
  const thrown = airborne(c, { ft: 30000, kt: 300 });
  thrown.state.omega = [MAX_RATE, MAX_RATE, MAX_RATE];
  check('thrown tumbling', thrown, 30, () => ({}),
    (log) => `ends at ${round(log.at(-1).kt)} kt, angle of attack ${round(log.at(-1).alpha)} deg`);

  table('Always checked: these end with a real state', rows);
});

test('the safety net ends a flight whose state breaks', () => {
  const sim = airborne(card());
  const good = sim.step({});
  sim.state = { ...good, v: [NaN, 0, 0] };
  sim.step({});
  assert.equal(sim.crashed?.reason, 'broken state');
  const frozen = sim.state;
  sim.step({});
  assert.equal(sim.state, frozen, 'after that the sim no longer steps');
});

test('with no ground there is no contact force', () => {
  const sim = airborne(card(), { ft: 0, kt: 200 });
  assert.ok(sim instanceof Sim);
  assert.equal(readout(sim).ft, 0);
  fly(sim, 1);
  assert.equal(sim.crashed, null);
});

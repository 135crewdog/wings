// The F-4C's checkride: maneuvers flown headless through Sim.step(), with the
// results in knots, feet, degrees and g next to the card's numbers. Card
// numbers are graded within the tolerances of the milestone 1 plan (stall
// speeds +-5 knots, top speeds +-5%, g limit and roll rate +-10%), each from
// the pull request that builds what it measures. Feel numbers are only
// reported.
//
// So far: the core flies and stalls. There is no engine yet and the control
// powers are placeholders. Graded: the clean stall speed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, airborne, fly, holdAltitude, readout, table, KT, FT, DEG, DT } from './fly.js';
import { liftCurve, separationWanted, aeroForces, airData } from '../src/sim/aero.js';
import { deriveCard } from '../src/sim/card.js';
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

test('the lift curve rises straight to max lift at the stall angle, then drops', () => {
  const c = card();
  const stall = c.alphaStall / DEG;
  const attached = (deg) => liftCurve(c, deg * DEG, 0), stalled = (deg) => liftCurve(c, deg * DEG, 1);
  table('The lift curve', [
    ['max lift', round(attached(stall), 3), `${round(c.CLmax, 3)} from the stall speed`],
    ['at angle of attack', `${round(stall, 1)} deg`],
    ['lift once stalled, same angle', round(stalled(stall), 2), `a ${round((1 - stalled(stall) / attached(stall)) * 100)}% drop`],
    ['stalled lift at 45 and 90 deg', `${round(stalled(45), 2)}, ${round(stalled(90), 2)}`],
  ]);
  assert.ok(Math.abs(attached(stall) - c.CLmax) < 1e-9, 'max lift is at the stall angle');
  for (let d = 0; d <= 180; d += 0.25) {
    assert.ok(attached(d) <= c.CLmax + 1e-12, 'attached lift never exceeds max lift');
    assert.ok(Math.abs(attached(d) + attached(-d)) < 1e-12 && Math.abs(stalled(d) + stalled(-d)) < 1e-12, 'the same upside down');
  }
  assert.ok(stalled(stall) < 0.85 * c.CLmax, 'lift drops when the wing stalls');
  // A wing that is not stalled wants to stay that way below the stall angle, and to stall above it.
  assert.equal(separationWanted(c, (stall - 0.1) * DEG, 0), 0);
  assert.ok(separationWanted(c, (stall + 1) * DEG, 0) > 0);
  // The F-4C mushes: its wing lets go of the stall as soon as the angle is back.
  assert.equal(c.stallHold, 0);
  assert.equal(separationWanted(c, (stall - 0.1) * DEG, 1), 0);
  // An airplane with a clear break stays stalled just below the stall angle, and lets go well below it.
  const snap = deriveCard({ ...c.pilot, nose_drop: 1 });
  assert.equal(separationWanted(snap, (stall - 1) * DEG, 1), 1);
  assert.equal(separationWanted(snap, stall * DEG - snap.stallHold - 0.01, 1), 0);
});

test('the stall adds no step in the forces', () => {
  const c = card();
  const atm = atmosphere(0);
  const moment = (deg, sep, omega = [0, 0, 0]) => {
    const a = deg * DEG, v = [100 * Math.cos(a), 0, 100 * Math.sin(a)];
    return aeroForces(c, airData(c, v, omega, atm), { elevator: 0, aileron: 0, rudder: 0 }, sep).M;
  };
  // Tumbling backward through +-180 degrees fully stalled, and through zero: the pitch moment carries on smoothly.
  for (const [lo, hi] of [[179.999999, -179.999999], [-0.000001, 0.000001]]) {
    assert.ok(Math.abs(moment(lo, [1, 1])[1] - moment(hi, [1, 1])[1]) < 1, `pitch moment is continuous between ${lo} and ${hi} deg`);
  }
  // The spin tendency belongs to the stall: in attached flight it changes nothing,
  // and stalled it comes in gradually as the roll rate passes through zero.
  const withSpin = (x) => deriveCard({ ...c.pilot, spin_tendency: x });
  const roll = (cc, sep, p) => {
    const a = 10 * DEG, v = [100 * Math.cos(a), 0, 100 * Math.sin(a)];
    return aeroForces(cc, airData(cc, v, [p, 0, 0.3], atm), { elevator: 0, aileron: 0, rudder: 0 }, sep).M[0];
  };
  for (const p of [-0.2, -1e-8, 0, 1e-8, 0.2]) {
    assert.equal(roll(withSpin(1), [0, 0], p), roll(withSpin(0), [0, 0], p), 'attached flight ignores the spin tendency');
  }
  const spinny = withSpin(1);
  assert.ok(Math.abs(roll(spinny, [1, 1], -1e-8) - roll(spinny, [1, 1], 1e-8)) < 1, 'no step at zero roll rate when stalled');
});

// Slow down in level flight at 1 g, low down, until the wing reaches the stall
// angle; from there the pilot holds the stick exactly where it is.
function stallStickHeld(c) {
  const sim = airborne(c, { ft: 3000, kt: 260, level: true });
  const hold = holdAltitude(3000);
  let frozen = null;
  const log = fly(sim, 90, (r) => {
    if (frozen) return frozen;
    const ctl = hold(r);
    if (r.sigma > 0) frozen = { elevator: ctl.elevator };
    return ctl;
  }, 0.05);
  const i = log.findIndex((r) => r.sigma > 0);
  assert.ok(i > 0, 'it reached the stall');
  const brk = log[i];
  const next = log.filter((r) => r.t >= brk.t && r.t <= brk.t + 5);
  const lowest = next.reduce((a, r) => (r.pitch < a.pitch ? r : a));
  return { brk, next, lowest, end: next.at(-1), firstBuffet: log.find((r) => r.buffet > 0), noseDrop: brk.pitch - lowest.pitch };
}

test('GRADED: clean stall speed', () => {
  const c = card();
  const { brk, next, end, firstBuffet, noseDrop } = stallStickHeld(c);
  table('Stall, clean, slowing in level flight at 3,000 ft, then stick held where it was', [
    ['stall speed', `${round(brk.kias, 1)} kt`, `${c.pilot.stall_clean_kt} kt +-5 (GRADED)`],
    ['g at the break', round(brk.g, 2)],
    ['buffet starts', `${round(firstBuffet.kias)} kt`, `${round(firstBuffet.kias - brk.kias)} kt of warning`],
    ['lowest g in the next 5 s', round(Math.min(...next.map((r) => r.g)), 2)],
    ['nose, over the next 5 s', `${round(brk.pitch)} to ${round(end.pitch)} deg`, `falls ${round(noseDrop)} deg at most`],
    ['angle of attack 5 s on', `${round(end.alpha)} deg`, `stall angle ${round(c.alphaStall / DEG)} deg`],
    ['sink rate 5 s on', `${round(-end.fpm)} ft/min`, `${round(-brk.fpm)} ft/min at the break`],
    ['speed 5 s on', `${round(end.kias)} kt`],
  ]);
  assert.ok(Math.abs(brk.g - 1) < 0.05, 'the stall was reached at 1 g');
  assert.ok(Math.abs(brk.kias - c.pilot.stall_clean_kt) <= 5, `stall speed ${brk.kias.toFixed(1)} kt is within 5 kt of the card`);
});

test('the nose-drop number runs from a mush to a clear break', () => {
  const c = card();
  const withNoseDrop = (x) => stallStickHeld(deriveCard({ ...c.pilot, nose_drop: x }));
  const mush = withNoseDrop(0), snap = withNoseDrop(1);
  table('The nose-drop feel number, stick held for 5 s after the stall', [
    ['at 0: nose falls', `${round(mush.noseDrop)} deg`, `sinking ${round(-mush.end.fpm)} ft/min, lowest g ${round(Math.min(...mush.next.map((r) => r.g)), 2)}`],
    ['at 1: nose falls', `${round(snap.noseDrop)} deg`, `sinking ${round(-snap.end.fpm)} ft/min, lowest g ${round(Math.min(...snap.next.map((r) => r.g)), 2)}`],
  ]);
  assert.ok(Math.abs(mush.brk.kias - snap.brk.kias) < 0.5, 'it does not move the stall speed');
  assert.ok(snap.noseDrop > 10, 'at 1, a clear nose drop at the break');
  assert.ok(mush.end.pitch > 10 && mush.noseDrop < snap.noseDrop / 2, 'at 0, the nose stays well above the horizon');
  assert.ok(-mush.end.fpm > -mush.brk.fpm + 500, 'at 0, it sinks instead');
});

// Unstalled and quiet: no buffet, and no fast roll, for the next two seconds.
const recovered = (log, from) => {
  const after = log.filter((r) => r.t >= from);
  const dt = after[1].t - after[0].t, span = Math.round(2 / dt);
  return after.find((r, i) => i + span < after.length && after.slice(i, i + span).every((x) => x.buffet === 0 && Math.abs(x.rollRate) < 20));
};

test('let go in a stall and it recovers', () => {
  const c = card();
  const sim = airborne(c, { ft: 15000, kt: 300, level: true });
  const hold = holdAltitude(15000);
  let brk = null;
  const log = fly(sim, 200, (r) => {
    if (!brk && r.sigma > 0.5) brk = r;
    return brk ? {} : hold(r);
  }, 0.05);
  assert.ok(brk, 'it stalled');
  const rec = recovered(log, brk.t);
  assert.ok(rec, 'it recovers hands off');
  const after = log.filter((r) => r.t >= brk.t);
  table('Stall, then hands off', [
    ['flying again after', `${round(rec.t - brk.t, 1)} s`],
    ['height lost by then', `${round(brk.ft - rec.ft)} ft`],
    ['nose falls to', `${round(Math.min(...after.filter((r) => r.t < brk.t + 10).map((r) => r.pitch)))} deg`, `from ${round(brk.pitch)} deg at the break`],
    ['wing drop', `${round(Math.max(...after.map((r) => Math.abs(r.roll))))} deg`, 'a straight stall has nothing to drop a wing'],
  ]);
  assert.ok(rec.t - brk.t < 10, 'within ten seconds');
});

test('a sloppy stall in a turn departs, and recovers when let go', () => {
  const c = card();
  const rows = [];
  // In a 45-degree banked turn, haul the stick all the way back and hold it for 15 seconds.
  const fling = (name, feet) => {
    const sim = airborne(c, { ft: 25000, kt: 320, level: true, roll: 45 });
    const log = fly(sim, 75, (r) => (r.t < 15 ? { elevator: 1, ...feet } : {}), 0.05);
    const held = log.filter((r) => r.t < 15);
    const rec = recovered(log, 15);
    assert.equal(sim.crashed, null);
    assert.ok(rec, `${name}: it recovers hands off`);
    const rolls = held.reduce((sum, r) => sum + Math.abs(r.rollRate) * 0.05, 0) / 360;
    rows.push([name, `roll to ${round(Math.max(...held.map((r) => Math.abs(r.rollRate))))} deg/s, ${round(rolls, 1)} rolls, yaw to ${round(Math.max(...held.map((r) => Math.abs(r.yawRate))))} deg/s, angle of attack to ${round(Math.max(...held.map((r) => r.alpha)))} deg`]);
    rows.push(['  let go', `flying again in ${round(rec.t - 15, 1)} s, ${round(held.at(-1).ft - rec.ft)} ft lower`]);
    return { held, rec };
  };
  const clean = fling('feet on the floor', {});
  const sloppy = fling('a bootful of rudder', { rudder: 0.3 });
  fling('everything crossed: full rudder and aileron', { rudder: 1, aileron: 1 });
  table('Stall in a turn, stick held full back for 15 s', rows);
  const peak = (run) => Math.max(...run.held.map((r) => Math.abs(r.rollRate)));
  assert.ok(peak(sloppy) > 3 * peak(clean), 'the sloppy one drops a wing; the coordinated one does not');
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

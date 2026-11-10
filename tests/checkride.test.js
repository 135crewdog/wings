// The F-4C's checkride: maneuvers flown headless through Sim.step(), with the
// results in knots, feet, degrees and g next to the card's numbers. Card
// numbers are graded within the tolerances of the milestone 1 plan (stall
// speeds +-5 knots, top speeds +-5%, g limit and roll rate +-10%), each from
// the pull request that builds what it measures. Feel numbers are only
// reported.
//
// So far: the core flies and stalls, with an engine, Mach effects and its
// limits. Graded: the clean stall speed, both top speeds, the g limit and the
// roll rate.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { card, airborne, fly, holdAltitude, gPilot, levelTurn, degreesTurned, readout, table, KT, FT, DEG, DT } from './fly.js';
import { liftCurve, separationWanted, aeroForces, airData } from '../src/sim/aero.js';
import { deriveCard } from '../src/sim/card.js';
import { Sim, finite, MAX_RATE } from '../src/sim/sim.js';
import { atmosphere } from '../src/sim/atmosphere.js';
import { powerStep, powerWanted, throttleFor, thrust, MIL_THROTTLE } from '../src/sim/engine.js';
import { calibratedAirspeed } from '../src/sim/airdata.js';
import { LB } from '../src/sim/card.js';
import { trimLevel } from '../src/sim/trim.js';

const round = (x, n = 0) => (n < 0 ? Math.round(x / 10 ** -n) * 10 ** -n : Number(x.toFixed(n)));

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
  table('Glide, hands off, engine at idle, from 30,000 ft', [
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
  // Tumbling through backward flight, through zero and through straight up and
  // down, however stalled the wing is: forces and moments carry on smoothly.
  const both = (deg, sep) => {
    const a = deg * DEG, v = [100 * Math.cos(a), 0, 100 * Math.sin(a)];
    const { F, M } = aeroForces(c, airData(c, v, [0, 0, 0], atm), { elevator: 0, aileron: 0, rudder: 0 }, sep);
    return [...F, ...M];
  };
  const eps = 1e-6;
  for (const sep of [[0, 0], [0.5, 0.5], [0.65, 0.56], [1, 1]]) {
    for (const [lo, hi] of [[180 - eps, -180 + eps], [-eps, eps], [90 - eps, 90 + eps], [-90 - eps, -90 + eps], [45 - eps, 45 + eps]]) {
      const before = both(lo, sep), after = both(hi, sep);
      before.forEach((x, k) => assert.ok(Math.abs(x - after[k]) < 1, `no step between ${lo} and ${hi} deg with the wing ${sep} stalled`));
    }
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
  // The game has no rudder pedal: the feet fly themselves. So the slop a
  // player can add at the stall is aileron, which is also how the real F-4
  // departs. The two rudder rows are for the record; nothing in the game can
  // fly them.
  const clean = fling('stick straight back', {});
  const sloppy = fling('and full tilt into the turn', { aileron: 1 });
  fling('(a bootful of rudder: not possible in the game)', { rudder: 0.3 });
  fling('(full rudder and aileron: not possible in the game)', { rudder: 1, aileron: 1 });
  table('Stall in a turn, stick held full back for 15 s', rows);
  const peak = (run) => Math.max(...run.held.map((r) => Math.abs(r.rollRate)));
  assert.ok(peak(sloppy) > 3 * peak(clean), 'the sloppy one drops a wing; the coordinated one does not');
});

test('the engine gives the card\'s thrust, with lag and an afterburner', () => {
  const c = card();
  const lb = (n) => n / (LB * 9.80665);
  assert.ok(Math.abs(lb(thrust(c, 1, 0, 1)) - c.pilot.thrust_mil_lb) < 1, 'MIL thrust, sea level, standing still');
  assert.ok(Math.abs(lb(thrust(c, 2, 0, 1)) - c.pilot.thrust_afterburner_lb) < 1, 'afterburner thrust, sea level, standing still');
  for (let p = 0; p < 2; p += 0.05) assert.ok(thrust(c, p + 0.05, 0.5, 0.7) > thrust(c, p, 0.5, 0.7), 'more power, more thrust');
  for (const t of [0, 0.3, MIL_THROTTLE, 0.9, 1]) assert.ok(Math.abs(throttleFor(powerWanted(t)) - t) < 1e-12);
  // Slam the throttle from idle to full and time the engine; then chop it.
  const timeTo = (from, throttle, reached) => {
    let p = from, t = 0;
    while (!reached(p) && t < 60) { p = powerStep(p, powerWanted(throttle), DT); t += DT; }
    return t;
  };
  const toMil = timeTo(0, 1, (p) => p >= 0.95), toFull = timeTo(0, 1, (p) => p >= 1.95), down = timeTo(2, 0, (p) => p <= 1);
  table('Engine', [
    ['MIL thrust, sea level, standing still', `${round(lb(thrust(c, 1, 0, 1)))} lb`, `${c.pilot.thrust_mil_lb} lb`],
    ['afterburner', `${round(lb(thrust(c, 2, 0, 1)))} lb`, `${c.pilot.thrust_afterburner_lb} lb`],
    ['idle', `${round(lb(thrust(c, 0, 0, 1)))} lb`],
    ['afterburner at 500 kt, sea level', `${round(lb(thrust(c, 2, (500 * KT) / atmosphere(0).a, 1)))} lb`],
    ['afterburner at Mach 2.2, 40,000 ft', `${round(lb(thrust(c, 2, 2.2, atmosphere(40000 * FT).rho / atmosphere(0).rho)))} lb`],
    ['thrust to weight, afterburner, standing still', round(c.thrustAfterburner / c.W, 2)],
    ['throttle slammed: idle to 95% of MIL', `${round(toMil, 1)} s`],
    ['then to full afterburner', `${round(toFull, 1)} s from idle`],
    ['throttle chopped: afterburner out in', `${round(down, 1)} s`],
  ]);
  assert.ok(toMil > 2 && toMil < 8, 'the engine takes a few seconds to spool');
  assert.ok(toFull > toMil, 'the afterburner lights after the engine reaches MIL');
});

test('the airspeed indicator reads true speed at sea level and less up high', () => {
  for (const kt of [100, 400, 780]) assert.ok(Math.abs(calibratedAirspeed(kt * KT, atmosphere(0)) / KT - kt) < 0.01);
  const high = atmosphere(40000 * FT);
  const kias = calibratedAirspeed(2.2 * high.a, high) / KT;
  assert.ok(kias > 600 && kias < 800, `Mach 2.2 at 40,000 ft reads ${kias.toFixed(0)} kt`);
});

test('trimmed, it flies level and steady with the controls held still', () => {
  const c = card();
  const rows = [];
  for (const [ft, kt] of [[5000, 300], [20000, 450], [35000, 550]]) {
    const sim = airborne(c, { ft, kt, level: true, throttle: 'trim' });
    assert.ok(sim.trim.possible);
    const start = readout(sim);
    const log = fly(sim, 60, () => ({ elevator: sim.trim.elevator, throttle: sim.trim.throttle }), 1);
    const end = log.at(-1);
    rows.push([`${ft} ft, ${round(start.kias)} kt indicated`, `throttle ${round(sim.trim.throttle * 100)}%, a minute later ${round(end.ft - ft)} ft, ${round(end.kias - start.kias)} kt`]);
    assert.ok(Math.abs(end.ft - ft) < 200 && Math.abs(end.kias - start.kias) < 5, `steady at ${ft} ft`);
  }
  table('Level-flight trim, controls held still for a minute', rows);
});

// Full afterburner in level flight until the speed settles.
function topSpeed(c, ft, kt, seconds) {
  const sim = airborne(c, { ft, kt, level: true, throttle: 1 });
  const hold = holdAltitude(ft, sim.trim.elevator);
  const log = fly(sim, seconds, (r) => ({ ...hold(r), throttle: 1 }), 5);
  const end = log.at(-1), before = log.at(-3);
  assert.equal(sim.crashed, null);
  assert.ok(Math.abs(end.ft - ft) < 100, 'held level');
  assert.ok(Math.abs((end.kt - before.kt) / (end.t - before.t)) < 0.1, 'the speed has settled');
  return end;
}

test('GRADED: top speeds', () => {
  const c = card();
  const p = c.pilot;
  // Each one approached from below and from above; the top speed is where they meet.
  const low = [0.9, 1.1].map((f) => topSpeed(c, 0, f * p.top_speed_low_kt, 150));
  const aHigh = atmosphere(p.top_speed_high_ft * FT).a / KT;
  const high = [0.9, 1.07].map((f) => topSpeed(c, p.top_speed_high_ft, f * p.top_speed_high_mach * aHigh, 400));
  const lowKt = (low[0].kt + low[1].kt) / 2, highMach = (high[0].mach + high[1].mach) / 2;
  table('Top speed, full afterburner, level', [
    ['sea level', `${round(lowKt)} kt`, `${p.top_speed_low_kt} kt +-5% (GRADED)`],
    ['  from below / from above', `${round(low[0].kt)} / ${round(low[1].kt)} kt`, `Mach ${round(low[0].mach, 2)}`],
    [`${p.top_speed_high_ft} ft`, `Mach ${round(highMach, 2)}`, `Mach ${p.top_speed_high_mach} +-5% (GRADED)`],
    ['  from below / from above', `Mach ${round(high[0].mach, 2)} / ${round(high[1].mach, 2)}`, `${round(high[0].kt)} kt true, ${round(high[0].kias)} kt indicated`],
  ]);
  assert.ok(Math.abs(lowKt / p.top_speed_low_kt - 1) <= 0.05, `sea-level top speed ${lowKt.toFixed(0)} kt is within 5% of the card`);
  assert.ok(Math.abs(highMach / p.top_speed_high_mach - 1) <= 0.05, `high top speed Mach ${highMach.toFixed(2)} is within 5% of the card`);
  assert.ok(Math.abs(low[0].kt - low[1].kt) < 0.02 * lowKt && Math.abs(high[0].mach - high[1].mach) < 0.02 * highMach, 'the same from below and from above');
});

test('performance with the engine', () => {
  const c = card();
  // MIL power, level: how fast without the afterburner.
  const mil = (ft, kt) => {
    const sim = airborne(c, { ft, kt, level: true, throttle: MIL_THROTTLE });
    const hold = holdAltitude(ft, sim.trim.elevator);
    return fly(sim, 300, (r) => ({ ...hold(r), throttle: MIL_THROTTLE }), 5).at(-1);
  };
  const milLow = mil(0, 500), milHigh = mil(30000, 500);
  // Level acceleration at 10,000 ft from 300 to 500 kt indicated.
  const accel = (throttle) => {
    const sim = airborne(c, { ft: 10000, kt: 300, level: true, throttle });
    const hold = holdAltitude(10000, sim.trim.elevator);
    const log = fly(sim, 240, (r) => ({ ...hold(r), throttle }), 0.1);
    const from = log.find((r) => r.kias >= 300), to = log.find((r) => r.kias >= 500);
    return to ? to.t - from.t : null;
  };
  // Level at 1,000 ft in afterburner: the knots gained per second passing 400
  // kt, and the steady climb rate the same spare thrust would give instead.
  const spare = (() => {
    const sim = airborne(c, { ft: 1000, kt: 350, level: true, throttle: 1 });
    const hold = holdAltitude(1000, sim.trim.elevator);
    const log = fly(sim, 30, (r) => ({ ...hold(r), throttle: 1 }), 0.5);
    const i = log.findIndex((r) => r.kt >= 400);
    const ktPerS = (log[i + 1].kt - log[i - 1].kt) / (log[i + 1].t - log[i - 1].t);
    return { ktPerS, fpm: ((ktPerS * KT * 400 * KT) / 9.80665 / FT) * 60 };
  })();
  const ab = accel(1), dry = accel(MIL_THROTTLE);
  table('Performance (reported, not graded)', [
    ['top speed at MIL, sea level', `${round(milLow.kt)} kt`, `Mach ${round(milLow.mach, 2)}`],
    ['top speed at MIL, 30,000 ft', `Mach ${round(milHigh.mach, 2)}`, `${round(milHigh.kias)} kt indicated`],
    ['300 to 500 kt, 10,000 ft, afterburner', ab ? `${round(ab, 1)} s` : 'does not get there'],
    ['300 to 500 kt, 10,000 ft, MIL', dry ? `${round(dry, 1)} s` : 'does not get there'],
    ['acceleration through 400 kt, 1,000 ft, afterburner', `${round(spare.ktPerS, 1)} kt/s`, `worth ${Math.round(spare.fpm / 1000) * 1000} ft/min of climb`],
  ]);
  assert.ok(ab !== null && (dry === null || ab < dry), 'the afterburner accelerates faster than MIL');
  assert.ok(milLow.kt < c.pilot.top_speed_low_kt, 'and MIL is slower than afterburner');
});

// From trimmed level flight at 1,000 ft at `kias`, snatch the stick to `stick` and hold it for 4 s.
function snatch(c, kias, stick) {
  const sim = airborne(c, { ft: 1000, kt: kias * 1.015, level: true, throttle: 'trim' });
  const log = fly(sim, 4.5, (r) => ({ elevator: r.t < 0.5 ? sim.trim.elevator : stick, throttle: 1 }), 0.02);
  const top = log.reduce((a, r) => (stick > 0 ? r.g > a.g : r.g < a.g) ? r : a);
  return { g: top.g, after: top.t - 0.5, kias: top.kias, stalled: Math.max(...log.map((r) => r.sigma)) > 0.5, alpha: Math.max(...log.map((r) => r.alpha)) };
}

test('GRADED: g limit', () => {
  const c = card();
  const limit = c.pilot.g_limit, corner = c.vCorner / KT;
  const fast = [500, 600, 700].map((kias) => ({ ...snatch(c, kias, 1), kias }));
  const slow = [250, 350, 450].map((kias) => ({ ...snatch(c, kias, 1), kias }));
  // And held: full back stick in a level turn in afterburner at 10,000 ft, read a quarter of the way round.
  const sim = airborne(c, { ft: 10000, kt: 520, level: true, throttle: 1 });
  const turn = levelTurn(10000, 1);
  const log = fly(sim, 12, (r) => ({ ...(r.t < 1.5 ? { elevator: sim.trim.elevator, aileron: turn(r).aileron } : turn(r)), throttle: 1 }), 0.1);
  const turned = degreesTurned(log);
  const quarter = log[turned.findIndex((d) => d >= 90)];
  const push = snatch(c, 500, -1);
  table('Full back tilt, snatched from level flight at 1,000 ft', [
    ...fast.map((r) => [`at ${round(r.kias, -1)} kt`, `${round(r.g, 1)} g`, `${limit} g +-10% (GRADED), reached in ${round(r.after, 1)} s`]),
    [`held in a level turn at 10,000 ft, a quarter of the way round at ${round(quarter.kias)} kt`, `${round(quarter.g, 1)} g`, `${limit} g +-10% (GRADED)`],
    ...slow.map((r) => [`at ${round(r.kias, -1)} kt`, `${round(r.g, 1)} g`, r.stalled ? `the wing stalls first (corner is ${round(corner)} kt)` : 'no stall']),
    ['full forward tilt at 500 kt', `${round(push.g, 1)} g`],
  ]);
  for (const r of fast) assert.ok(Math.abs(r.g / limit - 1) <= 0.1, `full back tilt at ${r.kias} kt gives ${r.g.toFixed(1)} g, within 10% of the card`);
  assert.ok(Math.abs(quarter.g / limit - 1) <= 0.1, `held in a turn it gives ${quarter.g.toFixed(1)} g, within 10% of the card`);
  assert.ok(quarter.kias > corner, 'read while still above corner speed');
  for (const r of slow.filter((x) => x.kias < corner - 50)) {
    assert.ok(r.stalled, `below corner at ${r.kias} kt the wing stalls first`);
    assert.ok(r.g < limit * 0.9, 'and gives less than the limit');
  }
});

// Full right stick from trimmed level flight; the steady rate is the average from 1.5 to 3 s in.
function rollAt(c, ft, kt) {
  const sim = airborne(c, { ft, kt, level: true, throttle: 'trim' });
  const log = fly(sim, 3, () => ({ elevator: sim.trim.elevator, aileron: 1, throttle: sim.trim.throttle }), 0.02);
  const late = log.filter((r) => r.t >= 1.5);
  let rolled = 0, quarterAt = null;
  for (let i = 1; i < log.length && quarterAt === null; i++) {
    rolled += log[i].rollRate * (log[i].t - log[i - 1].t);
    if (rolled >= 90) quarterAt = log[i].t;
  }
  return { rate: late.reduce((a, r) => a + r.rollRate, 0) / late.length, quarterAt, kias: log[0].kias, slip: Math.max(...log.map((r) => Math.abs(r.slip))) };
}

test('GRADED: roll rate', () => {
  const c = card();
  const p = c.pilot;
  const at = rollAt(c, 0, p.roll_rate_at_kt);
  const rows = [[250, 0], [600, 0], [600, 30000]].map(([kt, ft]) => ({ kt, ft, ...rollAt(c, ft, kt) }));
  table('Full right tilt from level flight', [
    [`at ${p.roll_rate_at_kt} kt, sea level`, `${round(at.rate)} deg/s`, `${p.roll_rate_dps} deg/s +-10% (GRADED); 90 deg of bank in ${round(at.quarterAt, 1)} s`],
    ...rows.map((r) => [`at ${r.kt} kt true, ${r.ft === 0 ? 'sea level' : `${r.ft} ft (${round(r.kias)} indicated)`}`, `${round(r.rate)} deg/s`]),
  ]);
  assert.ok(Math.abs(at.rate / p.roll_rate_dps - 1) <= 0.1, `roll rate ${at.rate.toFixed(0)} deg/s is within 10% of the card`);
  assert.ok(rows[0].rate < at.rate, 'slower, it rolls slower');
  assert.ok(rows[1].rate < 1.15 * at.rate, 'faster, the roll rate holds instead of growing');
});

test('hard turns bleed speed, and the feet fly themselves', () => {
  const c = card();
  const hard = (throttle) => {
    const sim = airborne(c, { ft: 10000, kt: 520, level: true, throttle });
    const turn = levelTurn(10000, 1);
    const log = fly(sim, 60, (r) => ({ ...(r.t < 1.5 ? { elevator: sim.trim.elevator, aileron: turn(r).aileron } : turn(r)), throttle }), 0.1);
    const turned = degreesTurned(log);
    const at = (deg) => { const i = turned.findIndex((d) => d >= deg); return i < 0 ? null : log[i]; };
    const entry = log.find((r) => r.t >= 1.5);
    const say = (r) => (r ? `${round(r.t - 1.5)} s, ${round(r.kias)} kt, ${round(r.g, 1)} g` : 'not reached in a minute');
    assert.equal(sim.crashed, null);
    assert.ok(Math.max(...log.map((r) => Math.abs(r.ft - 10000))) < 500, 'the turn was level');
    return { entry, half: at(180), full: at(360), say };
  };
  const ab = hard(1), mil = hard(MIL_THROTTLE);
  const level = [250, 450, 600].map((kt) => [kt, trimLevel(c, kt * KT, 0).elevator]);
  // Feet: the same full-stick roll with the rudder flown automatically, and with it held still.
  const feet = (rudder) => {
    const sim = airborne(c, { ft: 0, kt: 300, level: true, throttle: 'trim' });
    const log = fly(sim, 2, () => ({ elevator: sim.trim.elevator, aileron: 1, throttle: sim.trim.throttle, rudder }), 0.02);
    return Math.max(...log.map((r) => Math.abs(r.slip)));
  };
  const auto = feet(undefined), still = feet(0);
  table('Turning (reported, not graded)', [
    [`full back tilt, level, afterburner, from ${round(ab.entry.kias)} kt at 10,000 ft`, ''],
    ['  half way round', ab.say(ab.half)],
    ['  all the way round', ab.say(ab.full)],
    ['the same at MIL', ''],
    ['  half way round', mil.say(mil.half)],
    ['  all the way round', mil.say(mil.full)],
    ...level.map(([kt, e]) => [`tilt for level flight at ${kt} kt, sea level`, `${round(Math.abs(e) * 100)}% ${e >= 0 ? 'back' : 'forward'}`]),
    ['sideslip in a full-tilt roll at 300 kt', `${round(auto, 1)} deg`, `${round(still, 1)} deg with the rudder held still`],
  ]);
  assert.ok(ab.half.kias < ab.entry.kias, 'a hard turn costs speed even in afterburner');
  assert.ok(mil.half.kias < ab.half.kias, 'and more at MIL');
  assert.ok(auto < still, 'auto-coordination cuts the sideslip');
  assert.ok(level[0][1] > 0 && level[2][1] < 0, 'slower than neutral speed takes back tilt; faster takes forward');
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

  // A loop in afterburner: pull 4 g until the nose has come all the way round.
  let turned = 0;
  const pull = gPilot();
  const loop = check('loop', airborne(c, { ft: 15000, kt: 450, level: true, throttle: 1 }), 60, (r, sim) => {
    turned += sim.state.omega[1] * DT;
    return turned < 2 * Math.PI ? { elevator: pull(r, 4), aileron: 0, throttle: 1 } : { throttle: 1 };
  }, (log) => `${round(turned / DEG)} deg of pitch travel, top g ${round(Math.max(...log.map((r) => r.g)), 1)}, ${round(Math.min(...log.map((r) => r.kias)))} kt over the top, ${round(Math.max(...log.map((r) => r.ft)) - 15000)} ft gained`);
  assert.ok(turned >= 2 * Math.PI, 'the loop goes all the way round');
  assert.ok(Math.min(...loop.map((r) => r.kias)) > 100, 'with flying speed over the top');

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

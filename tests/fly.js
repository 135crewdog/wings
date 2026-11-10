// Shared set-ups for the checkride: start the F-4C somewhere in the sky, fly it
// with a control function, and read it out in pilot units.

import { deriveCard, FT, KT, DEG } from '../src/sim/card.js';
import { F4C } from '../src/sim/cards/f4c.js';
import { Sim, DT } from '../src/sim/sim.js';
import { qfromEuler, qtoEuler } from '../src/sim/vec.js';
import { onGround } from '../src/field.js';
import { flatGround } from '../src/sim/ground.js';
import { atmosphere } from '../src/sim/atmosphere.js';
import { calibratedAirspeed } from '../src/sim/airdata.js';
import { trimLevel } from '../src/sim/trim.js';

export { FT, KT, DEG, DT };
export const G = 9.80665;
const RHO0 = atmosphere(0).rho;
export const card = () => deriveCard(F4C);

/**
 * A sim in the air at `ft` and `kt` (true), pitched or rolled (degrees). With
 * `level: true` it starts at the angle of attack for level flight, and
 * `sim.trim` holds the elevator and throttle that keep it there. The engine
 * starts at `throttle`: a position 0..1, or 'trim' for the trimmed one.
 * `gear` and `flaps` start down when true; `ground` is a ground to land on.
 */
export function airborne(c, { ft = 10000, kt = 350, pitch = 0, roll = 0, level = false, throttle = 0, gear = false, flaps = false, ground = null } = {}) {
  const V = kt * KT;
  const trim = level ? trimLevel(c, V, ft * FT, { gear, flaps }) : null;
  const alpha = trim ? trim.alpha : 0;
  const sim = new Sim(c, {
    x: [0, 0, -ft * FT],
    v: [V * Math.cos(alpha), 0, V * Math.sin(alpha)],
    q: qfromEuler(roll * DEG, pitch * DEG + alpha, 0),
    omega: [0, 0, 0],
  }, { throttle: throttle === 'trim' ? trim.throttle : throttle, gear, flaps, ground });
  sim.trim = trim;
  return sim;
}

/**
 * A sim on a flat runway at sea level, on its wheels, rolling north at `kt`,
 * gear down. `sink` (ft/min) starts it just above the runway coming down
 * instead, as at touchdown, nose `pitch` degrees up.
 */
export function onRunway(c, { kt = 0, sink = 0, pitch = 0, roll = 0, flaps = false, gear = true, throttle = 0 } = {}) {
  return new Sim(c, onGround(c, { kt, sink, pitch, roll, gear }), { ground: flatGround(0), gear, flaps, throttle });
}

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const Q_REF = 0.5 * RHO0 * (250 * KT) ** 2;   // the stick gains below were set at 250 knots

/**
 * A pilot flying g with the elevator: returns pull(readout, gWanted) → the
 * elevator position. The stick is moved less the faster the airplane goes,
 * as a pilot does. `elevator` is where the stick starts.
 */
export function gPilot(elevator = 0) {
  let trim = elevator;
  return (r, gWanted) => {
    const soft = Math.min(1, Q_REF / Math.max(r.qbar, 1));
    const err = gWanted - r.g;
    trim = clamp(trim + 0.6 * soft * err * DT, -1, 1);
    return clamp(trim + soft * (0.25 * err - 0.01 * r.pitchRate), -1, 1);
  };
}

/**
 * A pilot in a hard level turn to the right: holds `stick` back, and banks
 * with the aileron to whatever keeps the altitude at `ft`. Returns
 * controls(readout); add a throttle to what it returns.
 */
export function levelTurn(ft, stick) {
  return (r) => {
    const level = Math.acos(clamp(1 / Math.max(r.g, 1), 0, 1)) / DEG;   // the bank that holds this g level
    const bank = clamp(level + clamp((r.ft - ft) * 0.02 + r.fpm * 0.004, -15, 15), r.t < 3 ? 78 : 0, 88);
    return { elevator: stick, aileron: clamp(0.04 * (bank - r.roll) - 0.015 * r.rollRate, -1, 1) };
  };
}

/** Degrees turned through between consecutive readouts, added up: headings wrap at +-180. */
export function degreesTurned(log) {
  let total = 0;
  return log.map((r, i) => {
    if (i > 0) total += ((r.heading - log[i - 1].heading + 540) % 360) - 180;
    return total;
  });
}

/** Wings level with the aileron. */
export const wingsLevel = (r) => clamp(-0.02 * r.roll - 0.01 * r.rollRate, -1, 1);

/**
 * A pilot holding altitude `ft`: returns controls(readout) that fly level with
 * the elevator, wings held level with the aileron. `elevator` is where the
 * stick starts. Add a throttle to what it returns to use the engine.
 */
export function holdAltitude(ft, elevator = 0) {
  const pull = gPilot(elevator);
  return (r) => {
    const climb = clamp((ft - r.ft) * 4, -600, 600);            // ft/min wanted, from the altitude error
    return { elevator: pull(r, clamp(1 + (climb - r.fpm) / 3000, 0.8, 1.2)), aileron: wingsLevel(r) };
  };
}

/** What a pilot would read off the airplane right now. */
export function readout(sim, controls = {}) {
  const obs = sim.observe(controls);
  const euler = qtoEuler(sim.state.q);
  const vw = sim.velocityWorld();
  return {
    t: sim.t,
    kt: obs.air.V / KT,
    kias: calibratedAirspeed(obs.air.V, atmosphere(-sim.state.x[2])) / KT,   // what the airspeed readout shows
    mach: obs.air.mach,
    qbar: obs.air.qbar,
    thrust: obs.thrust,
    power: sim.power,
    ft: -sim.state.x[2] / FT,
    fpm: (-vw[2] / FT) * 60,
    alpha: obs.air.alpha / DEG,
    pitch: euler.pitch / DEG,
    roll: euler.roll / DEG,
    heading: euler.yaw / DEG,
    slip: obs.air.beta / DEG,
    g: -obs.F[2] / sim.card.W + Math.cos(euler.pitch) * Math.cos(euler.roll),   // what the seat feels, along the airplane's "up"
    rollRate: sim.state.omega[0] / DEG,
    pitchRate: sim.state.omega[1] / DEG,
    yawRate: sim.state.omega[2] / DEG,
    sigma: obs.coef?.sigma ?? 0,        // how stalled the wing is, 0..1
    buffet: obs.coef?.buffet ?? 0,
    north: sim.state.x[0],
    east: sim.state.x[1],
    groundKt: Math.hypot(vw[0], vw[1]) / KT,
    onGround: sim.touching.some(Boolean),
  };
}

/**
 * Fly for `seconds` with controls(readout, sim) → { elevator, aileron, rudder }.
 * Returns the readouts, one per `every` seconds, the last one always included.
 */
export function fly(sim, seconds, controls = () => ({}), every = 1) {
  const log = [];
  const steps = Math.round(seconds / DT), stride = Math.max(1, Math.round(every / DT));
  let ctl = {};
  for (let i = 0; i < steps && !sim.crashed; i++) {
    if (i % stride === 0) log.push(readout(sim, ctl));
    ctl = controls(readout(sim, ctl), sim) ?? {};
    sim.step(ctl);
  }
  log.push(readout(sim, ctl));
  return log;
}

/** Prints a small table: rows of [label, value, card value or '']. */
export function table(title, rows) {
  console.log(`\n  ${title}`);
  const w = Math.max(...rows.map((r) => r[0].length));
  for (const [label, value, target] of rows) {
    console.log(`    ${label.padEnd(w)}  ${String(value).padStart(10)}${target ? `   card: ${target}` : ''}`);
  }
}

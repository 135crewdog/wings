// Shared set-ups for the checkride: start the F-4C somewhere in the sky, fly it
// with a control function, and read it out in pilot units.

import { deriveCard, FT, KT, DEG } from '../src/sim/card.js';
import { F4C } from '../src/sim/cards/f4c.js';
import { Sim, DT } from '../src/sim/sim.js';
import { qfromEuler, qtoEuler } from '../src/sim/vec.js';
import { atmosphere } from '../src/sim/atmosphere.js';

export { FT, KT, DEG, DT };
export const G = 9.80665;
const RHO0 = atmosphere(0).rho;
export const card = () => deriveCard(F4C);

/**
 * A sim in the air at `ft` and `kt` (true), pitched or rolled (degrees). With
 * `level: true` it starts at the angle of attack that holds 1 g, flying level.
 */
export function airborne(c, { ft = 10000, kt = 350, pitch = 0, roll = 0, level = false } = {}) {
  const V = kt * KT;
  const alpha = level ? (2 * c.W) / (atmosphere(ft * FT).rho * V * V * c.S * c.CLa) : 0;
  return new Sim(c, {
    x: [0, 0, -ft * FT],
    v: [V * Math.cos(alpha), 0, V * Math.sin(alpha)],
    q: qfromEuler(roll * DEG, pitch * DEG + alpha, 0),
    omega: [0, 0, 0],
  });
}

/**
 * A pilot holding altitude `ft`: returns controls(readout) that fly level with
 * the elevator, wings held level with the aileron. Used to slow down at 1 g.
 */
export function holdAltitude(ft) {
  let trim = 0;
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  return (r) => {
    const climb = clamp((ft - r.ft) * 4, -600, 600);            // ft/min wanted, from the altitude error
    const gWanted = clamp(1 + (climb - r.fpm) / 3000, 0.8, 1.2);
    const err = gWanted - r.g;
    trim = clamp(trim + 0.6 * err * DT, -1, 1);
    return { elevator: trim + 0.25 * err - 0.01 * r.pitchRate, aileron: clamp(-0.02 * r.roll - 0.01 * r.rollRate, -1, 1) };
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
    kias: (obs.air.V / KT) * Math.sqrt(obs.air.rho / RHO0),   // what the airspeed needle shows
    ft: -sim.state.x[2] / FT,
    fpm: (-vw[2] / FT) * 60,
    alpha: obs.air.alpha / DEG,
    pitch: euler.pitch / DEG,
    roll: euler.roll / DEG,
    g: -obs.F[2] / sim.card.W + Math.cos(euler.pitch) * Math.cos(euler.roll),   // what the seat feels, along the airplane's "up"
    rollRate: sim.state.omega[0] / DEG,
    pitchRate: sim.state.omega[1] / DEG,
    yawRate: sim.state.omega[2] / DEG,
    sigma: obs.coef?.sigma ?? 0,        // how stalled the wing is, 0..1
    buffet: obs.coef?.buffet ?? 0,
    north: sim.state.x[0],
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

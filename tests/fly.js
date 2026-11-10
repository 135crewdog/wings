// Shared set-ups for the checkride: start the F-4C somewhere in the sky, fly it
// with a control function, and read it out in pilot units.

import { deriveCard, FT, KT, DEG } from '../src/sim/card.js';
import { F4C } from '../src/sim/cards/f4c.js';
import { Sim, DT } from '../src/sim/sim.js';
import { qfromEuler, qtoEuler } from '../src/sim/vec.js';

export { FT, KT, DEG, DT };
export const G = 9.80665;
export const card = () => deriveCard(F4C);

/** A sim in the air at `ft` and `kt` (true), nose along the flight path unless pitched or rolled (degrees). */
export function airborne(c, { ft = 10000, kt = 350, pitch = 0, roll = 0 } = {}) {
  return new Sim(c, {
    x: [0, 0, -ft * FT],
    v: [kt * KT, 0, 0],
    q: qfromEuler(roll * DEG, pitch * DEG, 0),
    omega: [0, 0, 0],
  });
}

/** What a pilot would read off the airplane right now. */
export function readout(sim, controls = {}) {
  const obs = sim.observe(controls);
  const euler = qtoEuler(sim.state.q);
  const vw = sim.velocityWorld();
  return {
    t: sim.t,
    kt: obs.air.V / KT,
    ft: -sim.state.x[2] / FT,
    fpm: (-vw[2] / FT) * 60,
    alpha: obs.air.alpha / DEG,
    pitch: euler.pitch / DEG,
    roll: euler.roll / DEG,
    g: -obs.F[2] / sim.card.W + Math.cos(euler.pitch) * Math.cos(euler.roll),   // what the seat feels, along the airplane's "up"
    rollRate: sim.state.omega[0] / DEG,
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

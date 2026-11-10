// Level-flight trim with thrust: the angle of attack, elevator and throttle
// that hold steady level flight at a speed and altitude. Replaces wings-v1's
// glider trim (docs/sim-core-review.md, finding 19). Used to start a flight
// already settled. No browser code.

import { atmosphere } from './atmosphere.js';
import { liftSlope, liftDragFactor, zeroLiftDrag, elevatorPower } from './aero.js';
import { thrust, throttleFor } from './engine.js';

const RHO0 = atmosphere(0).rho;

// The stick position (-1..1) that gives a pitch moment, for an elevator with powers { up, down }.
const stick = (c, moment, power) => Math.max(-1, Math.min(1, moment >= 0 ? moment / Math.max(power.up, 1e-9) : moment / power.down));

/**
 * Trim at true airspeed V (m/s) and altitude h (m). Returns { alpha,
 * elevator, throttle, power, possible }: `possible` is false when full
 * afterburner can't hold the speed or the wing can't hold the weight, and
 * the rest is then the nearest it can do.
 */
export function trimLevel(c, V, h) {
  const atm = atmosphere(h);
  const mach = V / atm.a, qS = 0.5 * atm.rho * V * V * c.S;
  const CLa = liftSlope(c.AR, c.sweep, mach), K = liftDragFactor(c, mach), cd0 = zeroLiftDrag(c, mach);
  // Thrust is along the nose, so it carries a little of the weight; a few rounds settle it.
  let alpha = 0, T = 0, CL = 0;
  for (let i = 0; i < 8; i++) {
    CL = (c.W - T * Math.sin(alpha)) / qS;
    alpha = Math.min(CL, c.CLmax) / CLa;
    T = (qS * (cd0 + K * CL * CL)) / Math.cos(alpha);
  }
  const density = atm.rho / RHO0;
  // Thrust rises steadily with power, so bisect for the power that gives T.
  let lo = 0, hi = 2;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (thrust(c, mid, mach, density) < T) lo = mid; else hi = mid;
  }
  const power = (lo + hi) / 2;
  return {
    alpha,
    elevator: stick(c, -(c.Cm0 + c.Cma * Math.sin(alpha)), elevatorPower(c, V, 0.5 * atm.rho * V * V, CLa, c.CLmax / CLa)),
    throttle: throttleFor(power),
    power,
    possible: CL <= c.CLmax && thrust(c, 2, mach, density) >= T && thrust(c, 0, mach, density) <= T,
  };
}

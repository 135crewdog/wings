// What the instruments show: the airspeed indicator, whose formulas are
// Rage's (135crewdog/rage, src/sim/airdata.js), in SI units, and what the
// HUD reads off the airplane. No browser code.

import { atmosphere } from './atmosphere.js';
import { qrotate, qtoEuler } from './vec.js';

const SEA = atmosphere(0);

// Impact pressure over static pressure at a Mach number: what a pitot tube
// feels. Subsonic isentropic; supersonic, behind the shock (Rayleigh).
function impactRatio(mach) {
  if (mach <= 1) return Math.pow(1 + 0.2 * mach * mach, 3.5) - 1;
  return (166.9216 * Math.pow(mach, 7)) / Math.pow(7 * mach * mach - 1, 2.5) - 1;
}

/**
 * Calibrated airspeed (m/s) for true airspeed V (m/s) in the atmosphere
 * { p, a }: the sea-level speed that would give the pitot tube the same
 * push. It is what the airspeed readout shows, and what stall and corner
 * speeds are flown by. At sea level it equals true airspeed.
 */
export function calibratedAirspeed(V, atm) {
  const ratio = (impactRatio(V / atm.a) * atm.p) / SEA.p;
  let m = Math.sqrt(5 * (Math.pow(ratio + 1, 2 / 7) - 1));
  if (m > 1) {
    // Supersonic on the dial: solve the Rayleigh form with Newton steps.
    for (let i = 0; i < 20; i++) {
      const m2 = m * m;
      const f = (166.9216 * Math.pow(m, 7)) / Math.pow(7 * m2 - 1, 2.5) - 1 - ratio;
      const df = (166.9216 * Math.pow(m, 6) * (14 * m2 - 7)) / Math.pow(7 * m2 - 1, 3.5);
      const dm = f / df;
      m -= dm;
      if (Math.abs(dm) < 1e-12) break;
    }
  }
  return SEA.a * m;
}

const DEG = Math.PI / 180;

/**
 * What the HUD reads off the airplane, from a sim and what it observes
 * (sim.observe()): heading, pitch and roll (degrees; heading -180..180), the
 * g the seat feels along the airplane's "up", angle of attack and sideslip (degrees),
 * Mach, and three unit directions in north, east, down: where the airplane is
 * going (`velocity`), where its nose points (`nose`) and its own up (`up`,
 * for the bank scale's pointer). The tests read the same numbers.
 */
export function instruments(sim, seen) {
  const { roll, pitch, yaw } = qtoEuler(sim.state.q);
  const vw = sim.velocityWorld(), speed = Math.hypot(vw[0], vw[1], vw[2]);
  return {
    heading: yaw / DEG,
    pitch: pitch / DEG,
    roll: roll / DEG,
    g: -seen.F[2] / sim.card.W + Math.cos(pitch) * Math.cos(roll),
    alpha: seen.air.alpha / DEG,
    beta: seen.air.beta / DEG,
    mach: seen.air.mach,
    vsi: sim.climb,
    velocity: speed > 1 ? vw.map((x) => x / speed) : qrotate(sim.state.q, [1, 0, 0]),
    nose: qrotate(sim.state.q, [1, 0, 0]),
    up: qrotate(sim.state.q, [0, 0, -1]),
  };
}

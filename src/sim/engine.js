// The engine: thrust along the airplane's nose from the throttle, Mach and
// altitude, with spool lag and an afterburner stage. The structure is Rage's
// (135crewdog/rage, src/sim/engine.js); where Rage reads the F-16's thrust
// tables, this scales simple turbojet curves by the card's two thrust numbers,
// so one model serves every jet. No browser code.
//
// Power is the engine's state: 0 is idle, 1 is MIL (full power without the
// afterburner), 2 is full afterburner.

export const MIL_THROTTLE = 0.8;    // the detent: throttle 0..0.8 is idle to MIL, 0.8..1 is the afterburner
const IDLE = 0.05;                  // idle thrust as a fraction of MIL
const SPOOL = 1.5;                  // s: how fast the engine follows the throttle below MIL
const LIGHT = 0.6;                  // s: how fast the afterburner comes in and out
const LIGHT_AT = 0.95;              // the afterburner can light once the engine is this close to MIL
const MACH_MAX = 2.5;               // the curves hold their value beyond this

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** The power a throttle position (0..1) asks for. */
export function powerWanted(throttle) {
  const t = clamp(throttle, 0, 1);
  return t <= MIL_THROTTLE ? t / MIL_THROTTLE : 1 + (t - MIL_THROTTLE) / (1 - MIL_THROTTLE);
}

/** The throttle position that asks for a power (0..2): the inverse of powerWanted. */
export function throttleFor(power) {
  const p = clamp(power, 0, 2);
  return p <= 1 ? p * MIL_THROTTLE : MIL_THROTTLE + (p - 1) * (1 - MIL_THROTTLE);
}

/**
 * One step of dt: power follows what the throttle wants, with lag. Going up,
 * the engine spools to nearly MIL before the afterburner lights; coming down,
 * the afterburner goes out quickly and then the engine spools down.
 */
export function powerStep(power, wanted, dt) {
  const rising = wanted > power;
  const burner = rising ? power >= LIGHT_AT : power > 1;
  const target = rising && !burner ? Math.min(wanted, 1) : wanted;
  const next = power + (target - power) * Math.min(1, dt / (burner ? LIGHT : SPOOL));
  return Math.abs(next - target) < 1e-4 ? target : next;   // arrive, rather than approach for ever
}

/**
 * Thrust (N) at a power, Mach number and air density ratio (rho / sea-level
 * rho). Thrust thins with the air. With speed, a turbojet's MIL thrust sags a
 * little and then recovers as ram air packs the intake; afterburner thrust
 * climbs steeply with it.
 */
export function thrust(c, power, mach, densityRatio) {
  const m = clamp(mach, 0, MACH_MAX);
  const lapse = Math.pow(densityRatio, 0.7);
  const mil = c.thrustMil * lapse * (1 - 0.2 * m + 0.25 * m * m);
  if (power <= 1) return mil * (IDLE + (1 - IDLE) * clamp(power, 0, 1));
  const burner = c.thrustAfterburner * lapse * (1 + 0.35 * m * m);
  return mil + (burner - mil) * clamp(power - 1, 0, 1);
}

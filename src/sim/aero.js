// Aerodynamic forces and moments. The air data, ground effect and the way
// forces are assembled are from 135crewdog/wings-v1, src/sim/aero.js. The lift
// curve, the stall and the two-half wing are new: docs/sim-core-review.md,
// findings 1, 4 and 5. Pure functions of a derived card (card.js), the state
// and the controls. No browser code.
//
// The wing is two halves. Each sees its own airflow, because rolling and
// yawing move the halves through the air differently, and each makes its own
// lift and drag from the one lift curve. Roll damping, the wing drop at the
// stall, autorotation and its natural limit all come from that.
//
// Mach changes three things (finding 7): the lift slope, the drag that comes
// with lift, and the airplane's own drag, which rises through Mach 1.

import { norm } from './vec.js';

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const smoothstep = (x) => x * x * (3 - 2 * x);
const STALL_LAG = 0.1;   // s
const MACH_DD = 0.85;       // where the drag rise starts
const MACH_WAVE = 1.05;     // where it is fully in
const AUTOROTATION_ONSET = 0.005;   // lift-coefficient difference x roll rate (rad/s) at which the spin tendency is fully in

/**
 * Lift-curve slope (per radian) of a wing of aspect ratio AR and sweep (rad)
 * at a Mach number. Subsonic, it steepens toward Mach 1 (Prandtl-Glauert with
 * sweep), held from Mach 0.9; supersonic, it falls away as 4 / sqrt(M^2 - 1).
 */
export function liftSlope(AR, sweep, mach) {
  const beta2 = 1 - Math.min(mach, 0.9) ** 2;
  const subsonic = (2 * Math.PI * AR) / (2 + Math.sqrt(4 + AR * AR * (beta2 + Math.tan(sweep) ** 2)));
  return mach <= 1 ? subsonic : Math.min(subsonic, 4 / Math.sqrt(mach * mach - 1));
}

/**
 * The drag that comes with lift, as CD = K x CL^2. Subsonic it is the card's
 * induced drag; supersonic the wing's leading edge stops helping and K
 * becomes 1 / lift slope. Blended across Mach 0.9 to 1.2.
 */
export function liftDragFactor(c, mach) {
  const t = smoothstep(clamp((mach - 0.9) / 0.3, 0, 1));
  return t === 0 ? c.K : c.K + (1 / liftSlope(c.AR, c.sweep, mach) - c.K) * t;
}

/**
 * The airplane's own drag coefficient, at zero lift, against Mach: flat
 * below the drag rise, climbing through Mach 1, then a straight line through
 * the card's supersonic points. c.drag = { subsonic, at: [M1, cd1, M2, cd2] }.
 */
export function zeroLiftDrag(c, mach) {
  const { subsonic, at: [m1, cd1, m2, cd2] } = c.drag;
  if (mach <= MACH_DD) return subsonic;
  const line = (m) => cd1 + ((cd2 - cd1) * (clamp(m, MACH_WAVE, m2) - m1)) / (m2 - m1);
  if (mach >= MACH_WAVE) return line(mach);
  return subsonic + (line(MACH_WAVE) - subsonic) * smoothstep((mach - MACH_DD) / (MACH_WAVE - MACH_DD));
}

/**
 * How stalled a wing half wants to be at angle of attack alpha, 0 attached to
 * 1 fully stalled, given how stalled it already is. Stalled air does not
 * re-attach the moment the angle comes back: a stalled half behaves as if its
 * angle were higher, by up to the card's stallHold. That makes the break a
 * snap and the nose drop decisive, and is why recovery needs the angle
 * brought well below the stall.
 */
export function separationWanted(c, alpha, sigma, alphaStall = c.alphaStall) {
  const a = Math.abs(alpha) + c.stallHold * sigma;
  return smoothstep(clamp((a - alphaStall) / c.stallWidth, 0, 1));
}

/** One step of dt for both halves' stall state [right, left], which lags what each half wants by about a tenth of a second. */
export function separationStep(c, air, sep, dt) {
  const k = Math.min(1, dt / STALL_LAG);
  return [c.yHalf, -c.yHalf].map((y, i) => {
    const wanted = air.V < 1 ? 0 : separationWanted(c, halfFlow(air.Vb, air.omega, y).alpha, sep[i], air.alphaStall);
    const next = sep[i] + (wanted - sep[i]) * k;
    return Math.abs(next - wanted) < 1e-3 ? wanted : next;   // arrive, rather than approach for ever
  });
}

/**
 * The lift curve from flight school: straight up to max lift at the stall
 * angle, then a drop onto a flat plate's lift. `sigma` is how stalled the
 * half is. Symmetric, and defined at every angle with no step: past 45
 * degrees the attached part fades the way the plate's does, through zero at
 * 90 and again at 180, so a wing tumbling backward while still partly
 * attached gets no jolt. `CLa` is the lift slope at the Mach number flown;
 * left out, it is the card's low-speed one.
 */
export function liftCurve(c, alpha, sigma, CLa = c.CLa) {
  const a = Math.abs(alpha);
  const attached = a <= Math.PI / 4 ? Math.min(CLa * a, c.CLmax) : c.CLmax * Math.sin(2 * a);
  const plate = c.plateLift * Math.sin(2 * a);
  return (alpha < 0 ? -1 : 1) * ((1 - sigma) * attached + sigma * plate);
}

/** The buffet cue: 0 in ordinary flight, rising over the last fifth of the way to the stall angle, 1 at it and while stalled. */
export const buffet = (c, alpha, sigma, alphaStall = c.alphaStall) => Math.max(sigma, clamp((Math.abs(alpha) / alphaStall - 0.8) / 0.2, 0, 1));

/** The airflow one wing half sees, at spanwise station y (right is positive): body velocity plus omega x [0, y, 0]. */
function halfFlow(v, omega, y) {
  const u = v[0] - omega[2] * y, w = v[2] + omega[0] * y;
  return { alpha: Math.atan2(w, u), V2: u * u + w * w };
}

/**
 * The wing's force and its roll and yaw moments, in body axes, from its two
 * halves, given how stalled each is: sep = [right, left]. Also returns the
 * mean lift coefficient.
 */
export function wingForces(c, air, rho, sep) {
  const y = c.yHalf;
  const flows = [halfFlow(air.Vb, air.omega, y), halfFlow(air.Vb, air.omega, -y)];
  const curves = flows.map((f, i) => ({ CL: liftCurve(c, f.alpha, sep[i], air.CLa), sigma: sep[i] }));

  // A stalled half that is driving the roll already under way is autorotation.
  // The card's spin tendency scales that drive: 1 leaves the lift curve as it
  // is. It comes in with the stall and with the drive, so it changes nothing
  // in attached flight and has no step at zero roll rate.
  const mean = (curves[0].CL + curves[1].CL) / 2;
  let diff = (curves[0].CL - curves[1].CL) / 2;
  const drive = -diff * air.omega[0];   // more lift on the right rolls left
  diff *= 1 + (c.autorotation - 1) * Math.max(sep[0], sep[1]) * clamp(drive / AUTOROTATION_ONSET, 0, 1);
  const CLs = [mean + diff, mean - diff];

  const K = liftDragFactor(c, air.mach);
  let Fx = 0, Fz = 0, Mx = 0, Mz = 0;
  flows.forEach((f, i) => {
    const { sigma } = curves[i], CL = CLs[i];
    const sinA = Math.sin(f.alpha), cosA = Math.cos(f.alpha);
    // Attached: induced drag. Stalled: a flat plate's drag, whose force is square to the wing.
    const CD = (1 - sigma) * (air.ge ?? 1) * K * CL * CL + sigma * 2 * c.plateLift * sinA * sinA;
    const qS = 0.5 * rho * f.V2 * (c.S / 2);
    // Lift is square to the local airflow, drag along it.
    const fx = qS * (CL * sinA - CD * cosA), fz = qS * (-CL * cosA - CD * sinA);
    const yi = i === 0 ? y : -y;
    Fx += fx; Fz += fz;
    Mx += yi * fz; Mz -= yi * fx;
  });
  return { F: [Fx, 0, Fz], Mx, Mz, CL: mean, sigma: (curves[0].sigma + curves[1].sigma) / 2, sigmas: curves.map((k) => k.sigma) };
}

/**
 * Air data for body-axis velocity v (still air, so ground velocity is airflow),
 * body rates omega, and the local atmosphere { rho, a }. Carries the lift
 * slope and stall angle at this Mach number.
 */
export function airData(c, v, omega, atm) {
  const V = norm(v);
  const mach = V / atm.a, CLa = liftSlope(c.AR, c.sweep, mach);
  const out = { Vb: v, omega, V, rho: atm.rho, qbar: 0.5 * atm.rho * V * V, mach, CLa, alphaStall: c.CLmax / CLa, alpha: 0, beta: 0, qhat: 0, rhat: 0 };
  if (V < 1) return out;
  out.alpha = Math.atan2(v[2], v[0]);
  out.beta = Math.asin(clamp(v[1] / V, -1, 1));
  out.qhat = (omega[1] * c.cbar) / (2 * V);
  out.rhat = (omega[2] * c.b) / (2 * V);
  return out;
}

/**
 * McCormick's ground-effect factor on induced drag at height h (m) of the CG above the
 * ground, for span b: (16 h/b)² / (1 + (16 h/b)²). 1 far from the ground.
 */
export function groundEffect(h, b) {
  const x = (16 * Math.max(0, h)) / b;
  return (x * x) / (1 + x * x);
}

/**
 * Aerodynamic force and moment in body axes for controls { elevator, aileron,
 * rudder } in pilot sense, each -1..1, and the halves' stall state. `coef` carries what instruments and
 * tests read: CL, sigma (how stalled) and buffet. Below 1 m/s of airflow the
 * force and moment are zero.
 */
export function aeroForces(c, air, ctl, sep = [0, 0]) {
  if (air.V < 1) return { F: [0, 0, 0], M: [0, 0, 0], coef: null };
  const { alpha, beta, qhat, rhat } = air;
  const wing = wingForces(c, air, air.rho, sep);
  const qS = air.qbar * c.S;
  const Vhat = [air.Vb[0] / air.V, air.Vb[1] / air.V, air.Vb[2] / air.V];

  // The rest of the airplane: its own drag along the airflow, the fin's side
  // force, and the stability, damping and control moments.
  const CY = c.CYb * beta + c.rudder.cy * ctl.rudder;
  const Cl = c.Clb * beta + c.aileron.cl * ctl.aileron + c.rudder.cl * ctl.rudder;
  // sin(alpha) keeps the pitch moment continuous through +-180 degrees. The
  // break is the nose drop: a push toward lower angle of attack that comes in
  // with the stall, full strength from the stall angle on, fading to nothing
  // at 0 and at +-180 degrees so that it too has no step.
  const sinA = Math.sin(alpha);
  const Cm = c.Cm0 + c.Cma * sinA + c.Cmq * qhat + c.elevator.cm * ctl.elevator
    + c.cmBreak * wing.sigma * clamp(sinA / Math.sin(air.alphaStall), -1, 1);
  const Cn = c.Cnb * beta + c.Cnr * rhat + c.rudder.cn * ctl.rudder + c.aileron.cn * ctl.aileron;

  const cd0 = zeroLiftDrag(c, air.mach);
  const F = [
    wing.F[0] - qS * cd0 * Vhat[0],
    qS * (CY - cd0 * Vhat[1]),
    wing.F[2] - qS * cd0 * Vhat[2],
  ];
  const M = [wing.Mx + qS * c.b * Cl, qS * c.cbar * Cm, wing.Mz + qS * c.b * Cn];
  return { F, M, coef: { CL: wing.CL, sigma: wing.sigma, sigmas: wing.sigmas, buffet: buffet(c, alpha, wing.sigma, air.alphaStall) } };
}

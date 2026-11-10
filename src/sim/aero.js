// Aerodynamic coefficients, forces and moments. The air data, force assembly
// and ground effect are from 135crewdog/wings-v1, src/sim/aero.js; the lift,
// drag and pitch curves here are simple placeholders that hold at any angle,
// until the lift curve and stall are built. Pure functions of a derived card
// (card.js), the state and the controls. No browser code.

import { cross, normalize, norm } from './vec.js';

const Y_HAT = [0, 1, 0];
const QUARTER = Math.PI / 4;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/**
 * Placeholder lift curve: straight up to max lift at the stall angle, flat to
 * 45 degrees, then fading like a flat plate. Symmetric, defined at every angle.
 */
export function liftCurve(c, alpha) {
  const a = Math.abs(alpha), sign = alpha < 0 ? -1 : 1;
  if (a <= c.alphaStall) return c.CLa * alpha;
  if (a <= QUARTER) return sign * c.CLmax;
  return sign * c.CLmax * Math.sin(2 * a);
}

/** How far past the stall the wing is: 0 up to the stall angle, 1 from 45 degrees on. */
export const stalled = (c, alpha) => clamp((Math.abs(alpha) - c.alphaStall) / (QUARTER - c.alphaStall), 0, 1);

/**
 * Coefficients for air data { alpha, beta, phat, qhat, rhat, ge? } and controls
 * { elevator, aileron, rudder } in pilot sense, each -1..1.
 */
export function coefficients(c, air, ctl) {
  const { alpha, beta, phat, qhat, rhat } = air;
  const sinA = Math.sin(alpha);

  const CL = liftCurve(c, alpha);
  const CD = c.cd0 + (air.ge ?? 1) * c.K * CL * CL + stalled(c, alpha) * 2 * sinA * sinA;
  const CY = c.CYb * beta + c.rudder.cy * ctl.rudder;

  const Cl = c.Clb * beta + c.Clp * phat + c.ClrPerCL * CL * rhat + c.aileron.cl * ctl.aileron + c.rudder.cl * ctl.rudder;
  // sin(alpha) for alpha keeps the pitch moment continuous through +-180 degrees (review finding 4).
  const Cm = c.Cm0 + c.Cma * sinA + c.Cmq * qhat + c.elevator.cm * ctl.elevator;
  const Cn = c.Cnb * beta + c.CnpPerCL * CL * phat + c.Cnr * rhat + c.rudder.cn * ctl.rudder + c.aileron.cn * ctl.aileron;

  return { CL, CD, CY, Cl, Cm, Cn };
}

/**
 * Air data for body-axis velocity v (still air, so ground velocity is airflow),
 * body rates omega, and the local atmosphere { rho, a }.
 */
export function airData(c, v, omega, atm) {
  const V = norm(v);
  const out = { Vb: v, V, qbar: 0.5 * atm.rho * V * V, mach: V / atm.a, alpha: 0, beta: 0, phat: 0, qhat: 0, rhat: 0 };
  if (V < 1) return out;
  out.alpha = Math.atan2(v[2], v[0]);
  out.beta = Math.asin(clamp(v[1] / V, -1, 1));
  out.phat = (omega[0] * c.b) / (2 * V);
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

/** Lift direction in body axes for unit airflow V̂: normalize(ŷ × V̂). */
export const liftDirection = (Vhat) => normalize(cross(Y_HAT, Vhat));

/**
 * Aerodynamic force and moment in body axes, with the coefficients used.
 * Below 1 m/s of airflow both are zero.
 */
export function aeroForces(c, air, ctl) {
  if (air.V < 1) return { F: [0, 0, 0], M: [0, 0, 0], coef: null };
  const coef = coefficients(c, air, ctl);
  const Vhat = [air.Vb[0] / air.V, air.Vb[1] / air.V, air.Vb[2] / air.V];
  const L = liftDirection(Vhat);
  const qS = air.qbar * c.S;
  const F = [
    qS * (coef.CL * L[0] - coef.CD * Vhat[0]),
    qS * (coef.CL * L[1] - coef.CD * Vhat[1] + coef.CY),
    qS * (coef.CL * L[2] - coef.CD * Vhat[2]),
  ];
  const M = [qS * c.b * coef.Cl, qS * c.cbar * coef.Cm, qS * c.b * coef.Cn];
  return { F, M, coef };
}

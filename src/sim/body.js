// From 135crewdog/wings-v1, src/sim/body.js.
// Rigid-body equations of motion and the RK4 step.
//
// State: { x: world position (m), v: body-axis velocity of the CG over the ground (m/s),
//          q: attitude quaternion (body to world), omega: body rates p, q, r (rad/s) }.
// Forces and moments come from a function of (state, t) that returns body-axis { F, M }; this
// file knows nothing about where they come from.

import { cross, qmul, qnormalize, qrotate } from './vec.js';

/** Time derivatives of the state for body-axis force F and moment M. */
export function derivatives(state, F, M, m, I) {
  const { v, q, omega: w } = state;
  const wxv = cross(w, v);
  const Iw = [I[0] * w[0], I[1] * w[1], I[2] * w[2]];
  const wxIw = cross(w, Iw);
  const qd = qmul(q, [0, w[0], w[1], w[2]]);
  return {
    x: qrotate(q, v),
    v: [F[0] / m - wxv[0], F[1] / m - wxv[1], F[2] / m - wxv[2]],
    q: [0.5 * qd[0], 0.5 * qd[1], 0.5 * qd[2], 0.5 * qd[3]],
    omega: [(M[0] - wxIw[0]) / I[0], (M[1] - wxIw[1]) / I[1], (M[2] - wxIw[2]) / I[2]],
  };
}

const axpy = (a, x, s) => a.map((ai, i) => ai + s * x[i]);

function offset(state, d, s) {
  return { x: axpy(state.x, d.x, s), v: axpy(state.v, d.v, s), q: axpy(state.q, d.q, s), omega: axpy(state.omega, d.omega, s) };
}

/**
 * One classical RK4 step of size dt from time t. forces(state, t) returns body-axis { F, M }.
 * The quaternion is renormalized after the step.
 */
export function rk4Step(state, t, dt, forces, m, I) {
  const deriv = (s, time) => {
    const { F, M } = forces(s, time);
    return derivatives(s, F, M, m, I);
  };
  const k1 = deriv(state, t);
  const k2 = deriv(offset(state, k1, dt / 2), t + dt / 2);
  const k3 = deriv(offset(state, k2, dt / 2), t + dt / 2);
  const k4 = deriv(offset(state, k3, dt), t + dt);
  const combine = (key) =>
    state[key].map((s0, i) => s0 + (dt / 6) * (k1[key][i] + 2 * k2[key][i] + 2 * k3[key][i] + k4[key][i]));
  return { x: combine("x"), v: combine("v"), q: qnormalize(combine("q")), omega: combine("omega") };
}

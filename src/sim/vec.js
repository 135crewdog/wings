// From 135crewdog/wings-v1, src/sim/vec.js.
// Vectors [x, y, z] and quaternions [w, x, y, z] as plain arrays. Pure functions, no allocation
// tricks: clarity first, measure before optimizing.
//
// A unit quaternion q rotates body vectors into world vectors: v_w = R(q) v_b.

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const norm = (a) => Math.sqrt(dot(a, a));

export function normalize(a) {
  const n = norm(a);
  return n > 0 ? scale(a, 1 / n) : [0, 0, 0];
}

/** Hamilton product a ⊗ b. */
export function qmul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}

export const qnorm = (q) => Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]);

export function qnormalize(q) {
  const n = qnorm(q);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

export const qconj = (q) => [q[0], -q[1], -q[2], -q[3]];

/** R(q) v: body to world. Divides by |q|² so it stays a pure rotation mid-step in RK4. */
export function qrotate(q, v) {
  const [w, x, y, z] = q;
  const n2 = w * w + x * x + y * y + z * z;
  // t = 2 (q_vec × v) / |q|², v' = v + w t + q_vec × t
  const tx = (2 * (y * v[2] - z * v[1])) / n2;
  const ty = (2 * (z * v[0] - x * v[2])) / n2;
  const tz = (2 * (x * v[1] - y * v[0])) / n2;
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

/** R(q)ᵀ v: world to body. */
export const qrotateInv = (q, v) => qrotate(qconj(q), v);

export function qfromAxisAngle(axis, angle) {
  const a = normalize(axis), s = Math.sin(angle / 2);
  return [Math.cos(angle / 2), a[0] * s, a[1] * s, a[2] * s];
}

/** Attitude from Euler angles (rad): yaw ψ about world z, then pitch θ, then roll φ. */
export function qfromEuler(roll, pitch, yaw) {
  const cr = Math.cos(roll / 2), sr = Math.sin(roll / 2);
  const cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2);
  return [
    cr * cp * cy + sr * sp * sy,
    sr * cp * cy - cr * sp * sy,
    cr * sp * cy + sr * cp * sy,
    cr * cp * sy - sr * sp * cy,
  ];
}

/** Euler angles {roll, pitch, yaw} (rad) of a unit quaternion, the inverse of qfromEuler. */
export function qtoEuler(q) {
  const [w, x, y, z] = q;
  const sp = Math.max(-1, Math.min(1, 2 * (w * y - z * x)));
  return {
    roll: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
    pitch: Math.asin(sp),
    yaw: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
  };
}

/** The rotation angle (rad, 0..π) between two attitudes. atan2 keeps small angles exact. */
export function qangle(a, b) {
  const d = qmul(qconj(a), b);
  return 2 * Math.atan2(Math.hypot(d[1], d[2], d[3]), Math.abs(d[0]));
}

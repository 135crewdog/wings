// From 135crewdog/wings-v1, src/sim/atmosphere.js.
// International Standard Atmosphere.
// h is geopotential altitude (m), taken as -x_w.z. Below sea level the troposphere formula
// extends; above 20 km the 20 km values hold.

export const G0 = 9.80665; // m/s²
export const R_AIR = 287.053; // J/(kg K)
export const GAMMA = 1.4;

const T0 = 288.15, P0 = 101325, LAPSE = 0.0065, EXP = 5.25588;
const H_TROP = 11000, T_TROP = 216.65, P_TROP = 22632.1, H_TOP = 20000;

/** {T (K), p (Pa), rho (kg/m³), a (m/s)} at geopotential altitude h (m). */
export function atmosphere(h) {
  const hh = Math.min(h, H_TOP);
  let T, p;
  if (hh <= H_TROP) {
    T = T0 - LAPSE * hh;
    p = P0 * Math.pow(T / T0, EXP);
  } else {
    T = T_TROP;
    p = P_TROP * Math.exp((-G0 * (hh - H_TROP)) / (R_AIR * T));
  }
  return { T, p, rho: p / (R_AIR * T), a: Math.sqrt(GAMMA * R_AIR * T) };
}

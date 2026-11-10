// Pilot numbers to coefficients: turns an airplane's card (src/sim/cards/) into
// everything the simulation needs, in SI units. Replaces wings-v1's card.js and
// its stall solver (docs/sim-core-review.md, finding 5 and "Pilot numbers to
// coefficients"). No browser code.
//
// Parts marked "placeholder" are stand-ins until the milestone 1 pull request
// that builds them: the engine and drag (3), the control powers (4) and the
// ground systems (5).

import { G0, atmosphere } from './atmosphere.js';

export const LB = 0.45359237;          // kg
export const FT = 0.3048;              // m
export const KT = 1852 / 3600;         // m/s
export const DEG = Math.PI / 180;      // rad

const RHO0 = atmosphere(0).rho;

// Radius-of-gyration fractions typical of a jet fighter (Raymer's table):
// roll on the half span, pitch on the half length, yaw on their mean.
const GYRATION = { roll: 0.23, pitch: 0.38, yaw: 0.52 };

/** The derived card. `pilot` is a card from src/sim/cards/. */
export function deriveCard(pilot) {
  const m = pilot.weight_lb * LB;
  const W = m * G0;
  const b = pilot.span_ft * FT;
  const S = pilot.wing_area_sqft * FT * FT;
  const length = pilot.length_ft * FT;
  const sweep = pilot.sweep_deg * DEG;
  const AR = (b * b) / S;

  // Lift-curve slope of a swept, low-aspect-ratio wing at low speed (per radian).
  const CLa = (2 * Math.PI * AR) / (2 + Math.sqrt(4 + AR * AR * (1 + Math.tan(sweep) ** 2)));

  // Stall speed sets the most lift the wing can make: at the stall, lift equals weight.
  const vStall = pilot.stall_clean_kt * KT;
  const CLmax = (2 * W) / (RHO0 * S * vStall * vStall);

  // Stick neutral, the airplane balances at the lift it needs at the neutral speed.
  const vNeutral = pilot.neutral_speed_kt * KT;
  const CLneutral = (2 * W) / (RHO0 * S * vNeutral * vNeutral);
  const staticMargin = 0.08;

  return {
    name: pilot.name,
    pilot,
    // mass and inertia
    m,
    W,
    I: [
      m * (GYRATION.roll * b / 2) ** 2,
      m * (GYRATION.pitch * length / 2) ** 2,
      m * (GYRATION.yaw * (b + length) / 4) ** 2,
    ],
    // wing
    S,
    b,
    AR,
    cbar: S / b,
    sweep,
    CLa,
    CLmax,
    alphaStall: CLmax / CLa,
    K: 1 / (Math.PI * AR * 0.75),      // induced drag, with a span efficiency typical of a swept wing
    cd0: 0.02,                          // placeholder (3): comes from thrust = drag at top speed
    // speeds, for the checkride
    vStall,
    vNeutral,
    vCorner: vStall * Math.sqrt(pilot.g_limit),
    gLimit: pilot.g_limit,
    // stability and damping, geometry defaults
    Cm0: staticMargin * CLneutral,
    Cma: -CLa * staticMargin,
    Cmq: -4,
    CYb: -0.7,
    Clb: -0.08,
    Clp: -0.3,                          // placeholder (2): the two-half wing replaces it
    ClrPerCL: 0.25,
    Cnb: 0.12,
    CnpPerCL: -0.06,
    Cnr: -0.3,
    // control power at full deflection: placeholders (4)
    elevator: { cm: 0.1 },
    aileron: { cl: 0.03, cn: -0.002 },
    rudder: { cn: 0.02, cy: -0.1, cl: -0.002 },
    // ground contact: placeholders (5)
    contacts: [],
    crash: { wheelSink: Infinity, skidSpeed: Infinity },
  };
}

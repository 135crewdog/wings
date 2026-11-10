// Pilot numbers to coefficients: turns an airplane's card (src/sim/cards/) into
// everything the simulation needs, in SI units. Replaces wings-v1's card.js and
// its stall solver (docs/sim-core-review.md, finding 5 and "Pilot numbers to
// coefficients"). No browser code.
//
// Parts marked "placeholder" are stand-ins until the milestone 1 pull request
// that builds them: the control powers (4) and the ground systems (5).
//
// The feel numbers on a card run 0..1 and map onto physical quantities
// through `feel(low, high, x)`: 0 gives `low`, 1 gives `high`.

import { G0, atmosphere } from './atmosphere.js';
import { liftSlope, liftDragFactor } from './aero.js';
import { thrust } from './engine.js';

export const LB = 0.45359237;          // kg
export const FT = 0.3048;              // m
export const KT = 1852 / 3600;         // m/s
export const DEG = Math.PI / 180;      // rad

const RHO0 = atmosphere(0).rho;
const feel = (low, high, x) => low + (high - low) * x;

// Radius-of-gyration fractions typical of a jet fighter (Raymer's table):
// roll on the half span, pitch on the half length, yaw on their mean.
const GYRATION = { roll: 0.23, pitch: 0.38, yaw: 0.52 };
const SUBSONIC_CD0 = 0.022;   // a clean jet fighter's own drag, below the drag rise

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
  const CLa = liftSlope(AR, sweep, 0);

  // Stall speed sets the most lift the wing can make: at the stall, lift equals weight.
  const vStall = pilot.stall_clean_kt * KT;
  const CLmax = (2 * W) / (RHO0 * S * vStall * vStall);

  // Stick neutral, the airplane balances at the lift it needs at the neutral speed.
  const vNeutral = pilot.neutral_speed_kt * KT;
  const CLneutral = (2 * W) / (RHO0 * S * vNeutral * vNeutral);
  const staticMargin = 0.08;

  const c = {
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
    // The stall (aero.js): past the stall angle, lift falls over `stallWidth`
    // onto a flat plate's lift, plateLift x sin(2 alpha).
    stallWidth: feel(10, 2, pilot.stall_sharpness) * DEG,
    plateLift: 0.85,
    // How the stall breaks, from the card's nose-drop number. Once stalled, the
    // wing stays stalled until the angle of attack is `stallHold` back below
    // the stall angle, and while stalled the nose is pushed down with the pitch
    // moment of that much angle of attack. At 0 there is neither: lift just
    // falls away and the airplane mushes, nose high, sinking. At 1 the break
    // is a snap with a clear nose drop.
    stallHold: feel(0, 12, pilot.nose_drop) * DEG,
    cmBreak: -CLa * staticMargin * feel(0, 12, pilot.nose_drop) * DEG,
    // Each wing half's lift acts this far out. It sets the roll damping:
    // -2 CLa (yHalf / b)^2, about -0.29 here, typical of a fighter.
    yHalf: 0.23 * b,
    // How strongly a stalled wing half drives the roll it is already in: 1 is
    // what the lift curve gives by itself, 0 none, 2 double.
    autorotation: feel(0, 2, pilot.spin_tendency),
    K: 1 / (Math.PI * AR * 0.75),      // induced drag, with a span efficiency typical of a swept wing
    // engine: both thrust numbers are at sea level, standing still
    thrustMil: pilot.thrust_mil_lb * LB * G0,
    thrustAfterburner: pilot.thrust_afterburner_lb * LB * G0,
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
    Cnb: 0.12,
    Cnr: -0.3,
    // control power at full deflection: placeholders (4)
    elevator: { cm: 0.1 },
    aileron: { cl: 0.03, cn: -0.002 },
    rudder: { cn: 0.02, cy: -0.1, cl: -0.002 },
    // ground contact: placeholders (5)
    contacts: [],
    crash: { wheelSink: Infinity, skidSpeed: Infinity },
  };

  // Top speed is where thrust meets drag, so each top speed on the card says
  // what the airplane's own drag must be there. A jet whose low top speed is
  // already supersonic gives two points on the supersonic drag line, and its
  // subsonic drag is a typical figure for a fighter; otherwise the low top
  // speed gives the subsonic drag and the high one the supersonic.
  const high = atmosphere(pilot.top_speed_high_ft * FT);
  const low = dragAtTopSpeed(c, pilot.top_speed_low_kt * KT, atmosphere(0));
  const hi = dragAtTopSpeed(c, pilot.top_speed_high_mach * high.a, high);
  c.drag = low.mach > 0.85
    ? { subsonic: Math.min(SUBSONIC_CD0, low.cd), at: [low.mach, low.cd, hi.mach, hi.cd] }
    : { subsonic: low.cd, at: [1.05, hi.cd, Math.max(hi.mach, 1.1), hi.cd] };
  return c;
}

/** The zero-lift drag coefficient that makes full-afterburner thrust equal drag in level flight at speed V. */
function dragAtTopSpeed(c, V, atm) {
  const mach = V / atm.a, qS = 0.5 * atm.rho * V * V * c.S;
  const CL = c.W / qS;
  return { mach, cd: thrust(c, 2, mach, atm.rho / RHO0) / qS - liftDragFactor(c, mach) * CL * CL };
}

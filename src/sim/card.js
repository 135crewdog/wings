// Pilot numbers to coefficients: turns an airplane's card (src/sim/cards/) into
// everything the simulation needs, in SI units. Replaces wings-v1's card.js and
// its stall solver (docs/sim-core-review.md, finding 5 and "Pilot numbers to
// coefficients"). No browser code.
//
// The feel numbers on a card run 0..1 and map onto physical quantities
// through `feel(low, high, x)`: 0 gives `low`, 1 gives `high`.

import { G0, atmosphere } from './atmosphere.js';
import { liftSlope, liftDragFactor } from './aero.js';
import { thrust } from './engine.js';
import { Sim, DT } from './sim.js';
import { trimLevel } from './trim.js';
import { qfromEuler } from './vec.js';

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
  const yHalf = 0.23 * b;

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
    yHalf,
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
    Cmq: -2,       // pitch damping on pitch rate: kept small, because it costs held g
    Cmad: -8,     // pitch damping on the angle of attack changing: settles the nose, costs no g
    CYb: -0.7,
    Clb: -0.08,
    Cnb: 0.12,
    Cnr: -0.3,
    // Limits come from control power, not a limiter (aero.js, elevatorPower
    // and aileronPower). Full back stick asks for the g limit; full forward
    // for gDown, a geometry default, since cards carry no negative limit.
    gDown: 0.35 * pilot.g_limit,
    // Full aileron gives the card's roll rate at its speed (sea level): the
    // roll moment that balances the two-half wing's roll damping there.
    aileron: { cl: CLa * (yHalf / b) ** 2 * (pilot.roll_rate_dps * DEG) * b / (pilot.roll_rate_at_kt * KT), adverseYaw: 0.07 },
    qRoll: 0.5 * RHO0 * (pilot.roll_rate_at_kt * KT) ** 2,
    // Full rudder holds about 6 degrees of sideslip. There is no rudder pedal
    // in the game: the sim's auto-coordination flies it.
    rudder: { cn: 0.12 * 6 * DEG, cy: -0.1, cl: -0.002 },
    // Flaps: the landing stall speed says how much more lift they give.
    flapLift: (2 * W) / (RHO0 * S * (pilot.stall_landing_kt * KT) ** 2) - CLmax,
    flapDrag: feel(0.02, 0.08, pilot.flap_drag),
    gearDrag: feel(0.01, 0.04, pilot.gear_drag),
    // Ground contact: where the airplane can touch, as measured from its 3D model.
    contacts: contactPoints(W, m, pilot),
    // Only a hard arrival ends a flight (m/s of sink at the point that touches).
    crash: { wheelSink: 8, bodySink: 6 },
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

  // The aileron power above balances roll damping alone. A real roll also
  // stirs up sideslip, the rudder and the wing's own speed changes, which
  // cost about a fifth of the rate, so fly the roll and scale the power
  // until full stick gives the card's rate.
  for (let i = 0; i < 3; i++) c.aileron.cl *= (pilot.roll_rate_dps * DEG) / rollRate(c, pilot.roll_rate_at_kt * KT);
  return c;
}

/** The steady roll rate (rad/s) from full right stick in level flight at sea level at speed V: flown, averaged from 1.5 to 3 s in. */
export function rollRate(c, V) {
  const trim = trimLevel(c, V, 0);
  const sim = new Sim(c, {
    x: [0, 0, 0],
    v: [V * Math.cos(trim.alpha), 0, V * Math.sin(trim.alpha)],
    q: qfromEuler(0, trim.alpha, 0),
    omega: [0, 0, 0],
  }, { throttle: trim.throttle });
  const controls = { elevator: trim.elevator, aileron: 1, throttle: trim.throttle };
  let sum = 0, n = 0;
  for (let t = 0; t < 3; t += DT) {
    sim.step(controls);
    if (t >= 1.5) { sum += sim.state.omega[0]; n++; }
  }
  return sum / n;
}

/**
 * Contact points in body axes (x forward, y right, z down, metres from the
 * CG), from the card's measurements of the 3D model. Wheels, and the other
 * gear points, are there only with the gear down; the rest is the airframe
 * itself. Each has a spring and
 * damper sized to the share of the weight it carries: for the wheels, the
 * share that balances the airplane on them.
 */
function contactPoints(W, m, pilot) {
  const metres = (p) => p.map((x) => x * FT);
  const strut = (share, sag) => {
    const k = (share * W) / sag;
    return { k, c: Math.sqrt(k * share * m) };   // about half of critical damping
  };
  // A wheel is two contact points, at the two edges of its tyre, sharing its load.
  const wheel = (name, key, share, extra) => [-1, 1].map((side) => {
    const [x, y, z] = pilot.wheels_ft[key];
    return { name, wheel: true, r: metres([x, y + (side * pilot.tyre_width_ft[key]) / 2, z]), ...strut(share / 2, 0.15), ...extra };
  });
  const skid = (r, i) => ({ name: `airframe ${i + 1}`, wheel: false, r: metres(r), ...strut(1, 0.1) });
  const { nose, left } = pilot.wheels_ft;
  // The mains sit behind the CG and the nose wheel ahead: the nose wheel carries what the lever leaves it.
  const noseShare = -left[0] / (nose[0] - left[0]);
  return [
    ...wheel('nose wheel', 'nose', noseShare, { steers: true }),
    ...wheel('left main', 'left', (1 - noseShare) / 2, { brake: true }),
    ...wheel('right main', 'right', (1 - noseShare) / 2, { brake: true }),
    ...pilot.gear_ft.map((r, i) => ({ ...skid(r, i), name: `gear ${i + 1}`, gearOnly: true })),
    ...pilot.airframe_ft.map(skid),
  ];
}

/** The zero-lift drag coefficient that makes full-afterburner thrust equal drag in level flight at speed V. */
function dragAtTopSpeed(c, V, atm) {
  const mach = V / atm.a, qS = 0.5 * atm.rho * V * V * c.S;
  const CL = c.W / qS;
  return { mach, cd: thrust(c, 2, mach, atm.rho / RHO0) / qS - liftDragFactor(c, mach) * CL * CL };
}

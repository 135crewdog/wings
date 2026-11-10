// The F-4C Phantom II's card: numbers a pilot recognizes. src/sim/card.js
// derives every engineering coefficient from these.

export const F4C = {
  name: 'F-4C Phantom II',

  // From public spec sheets, at one fixed weight (a clean jet, about half internal fuel).
  weight_lb: 38000,
  span_ft: 38.4,
  wing_area_sqft: 530,
  sweep_deg: 45,
  length_ft: 58.2,
  thrust_mil_lb: 21800,          // both engines, sea level, standing still
  thrust_afterburner_lb: 34000,
  stall_clean_kt: 145,           // indicated, 1 g, sea level
  stall_landing_kt: 125,         // gear and flaps down
  top_speed_low_kt: 780,         // sea level, full afterburner
  top_speed_high_mach: 2.2,      // at top_speed_high_ft, full afterburner
  top_speed_high_ft: 40000,
  g_limit: 8.5,
  roll_rate_dps: 180,            // at roll_rate_at_kt
  roll_rate_at_kt: 400,

  // Where it can touch the ground, measured from the 3D model (models/f4c.glb):
  // feet from the centre of gravity, [forward, right, down]. The wheels are
  // where the tyres meet the runway with the gear down; the rest is the
  // airframe with the gear up. A test fails if these and the model disagree.
  wheels_ft: { nose: [22.43, 0, 6.56], left: [-1.97, -9.26, 6.56], right: [-1.97, 9.26, 6.56] },
  airframe_ft: { nose: [31.6, 0, 1.61], belly: [12.48, 0, 1.52], tail: [-24.56, 0, -0.93], wingtip: [-10.96, 19.2, -0.52] },

  // Tuned by feel on the phone. The 0..1 ones start in the middle.
  neutral_speed_kt: 350,
  stall_sharpness: 0.5,
  nose_drop: 0,                  // the F-4 has no clean break: buffet, then a nose-high mush with a high sink rate
  spin_tendency: 0.5,
  gear_drag: 0.5,
  flap_drag: 0.5,
};

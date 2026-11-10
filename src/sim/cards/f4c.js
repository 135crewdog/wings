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
  // where the tyres meet the runway with the gear down, each as wide as its
  // tyres. The airframe points
  // are whatever reaches the ground first, gear up, at any attitude from nose
  // 10 degrees down to 20 up and 30 degrees of bank; the gear points are what
  // else hangs lowest with the gear down. A test fails if these and the model
  // disagree.
  wheels_ft: { nose: [22.43, 0, 6.56], left: [-1.97, -9.26, 6.56], right: [-1.97, 9.26, 6.56] },
  tyre_width_ft: { nose: 1.9, left: 0.68, right: 0.68 },   // the nose leg has two tyres side by side
  gear_ft: [],
  airframe_ft: [
    [29.51, -0.65, 2.37],
    [29.51, 0.65, 2.37],
    [28.19, 0, 2.8],
    [-2.86, -10.12, 1.35],
    [-2.86, 10.12, 1.35],
    [-6.95, -19.09, -0.5],
    [-6.95, 19.09, -0.5],
    [-10.32, -13.5, 0.71],
    [-10.32, 13.5, 0.71],
    [-10.96, -19.2, -0.52],
    [-10.96, 19.2, -0.52],
    [-12.24, 0, 1.07],
    [-26.6, -8.66, -1.1],
    [-26.6, 8.66, -1.1],
  ],

  // Tuned by feel on the phone. The 0..1 ones start in the middle.
  neutral_speed_kt: 350,
  stall_sharpness: 0.5,
  nose_drop: 0,                  // the F-4 has no clean break: buffet, then a nose-high mush with a high sink rate
  spin_tendency: 0.5,
  gear_drag: 0.5,
  flap_drag: 0.5,
};

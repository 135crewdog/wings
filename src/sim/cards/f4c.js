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

  // Tuned by feel on the phone. The 0..1 ones start in the middle.
  neutral_speed_kt: 350,
  stall_sharpness: 0.5,
  nose_drop: 0.5,
  spin_tendency: 0.5,
  gear_drag: 0.5,
  flap_drag: 0.5,
};

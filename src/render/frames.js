// From the simulation's axes to the picture's. After 135crewdog/wings-v1,
// src/render/frames.js.
//
// The simulation's world is north, east, down; an airplane's own axes are
// nose, right wing, belly. Three.js's world is x east, y up, z south; a model
// built to docs/models.md has its nose along -z, right wing +x, top +y. Both
// pairs are related by the same swap of axes, (x, y, z) -> (y, -z, -x), so an
// attitude goes across by swapping its quaternion's parts the same way.
// No Three.js code here: plain arrays, so it is tested headless.

/** A position or direction: [north, east, down] to Three.js's [x, y, z]. */
export const toThree = (v) => [v[1], -v[2], -v[0]];

/** An attitude: the simulation's [w, x, y, z] to Three.js's [x, y, z, w]. */
export const attitudeToThree = (q) => [q[2], -q[3], -q[1], q[0]];

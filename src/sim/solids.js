// The solid shapes of the island's landmarks: plain boxes, each turned and
// stretched to wrap one pier, tower or wall (docs/models.md, "Landmarks").
// The flight model can't use the picture to tell what is solid; it asks here.
// Metres; north, east and up from the island's middle and sea level. No browser code.

/**
 * boxes: [{ name, centre: [north, east, up], half: [a, b, c], axes: [[n, e, u] x 3] }]: a box's
 * middle, its half-lengths along its own three axes, and those axes as unit
 * vectors. Returns { at(north, east, up) → the name of the box that point is inside, or null }.
 */
export function createSolids(boxes) {
  // A ball round each box says "nowhere near" cheaply, for nearly every point asked about.
  const balls = boxes.map((b) => Math.hypot(...b.half) ** 2);
  function at(north, east, up) {
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i], d = [north - b.centre[0], east - b.centre[1], up - b.centre[2]];
      if (d[0] * d[0] + d[1] * d[1] + d[2] * d[2] > balls[i]) continue;
      if (b.axes.every((a, k) => Math.abs(d[0] * a[0] + d[1] * a[1] + d[2] * a[2]) <= b.half[k])) return b.name;
    }
    return null;
  }
  return { at };
}

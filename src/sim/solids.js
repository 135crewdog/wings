// The solid shapes of the island's landmarks: plain boxes, each turned and
// stretched to wrap one pier, tower or wall (docs/models.md, "Landmarks").
// The flight model can't use the picture to tell what is solid; it asks here.
// Metres; north, east and up from the island's middle and sea level. No browser code.

/**
 * boxes: [{ name, centre: [north, east, up], half: [a, b, c], axes: [[n, e, u] x 3] }]: a box's
 * middle, its half-lengths along its own three axes, and those axes as unit vectors.
 * Returns { between(from, to) → the name of a box that the straight path from one
 * point to the other touches, or null }. Each point is [north, east, up]. A path, not a
 * place: in one step a fast jet moves farther than a thin wall is thick.
 */
/** The Strip's hotels (sites.strip of terrain/island.json) as solid boxes: each stands upright, square to the map. */
export function hotelSolids(strip) {
  return strip.hotels.map((h, i) => ({ name: `hotel_${i + 1}`, centre: [h.north, h.east, strip.height + h.height / 2], half: [h.along / 2, h.across / 2, h.height / 2], axes: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] }));
}

export function createSolids(boxes) {
  // A ball round each box says "nowhere near" cheaply, for nearly every path asked about.
  const balls = boxes.map((b) => Math.hypot(...b.half));
  function between(from, to) {
    const mid = [0, 1, 2].map((k) => (from[k] + to[k]) / 2), reach = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / 2;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (Math.hypot(mid[0] - b.centre[0], mid[1] - b.centre[1], mid[2] - b.centre[2]) > balls[i] + reach) continue;
      // In the box's own axes it is three pairs of faces; the path is inside it for the
      // part of its length, 0 to 1, that lies between all three pairs at once.
      let enter = 0, leave = 1;
      for (let k = 0; k < 3 && enter <= leave; k++) {
        const a = b.axes[k], dot = (p) => (p[0] - b.centre[0]) * a[0] + (p[1] - b.centre[1]) * a[1] + (p[2] - b.centre[2]) * a[2];
        const p0 = dot(from), dp = dot(to) - p0, h = b.half[k];
        if (Math.abs(dp) < 1e-9) { if (Math.abs(p0) > h) enter = 2; continue; }
        const t1 = (-h - p0) / dp, t2 = (h - p0) / dp;
        enter = Math.max(enter, Math.min(t1, t2));
        leave = Math.min(leave, Math.max(t1, t2));
      }
      if (enter <= leave) return b.name;
    }
    return null;
  }
  return { between };
}

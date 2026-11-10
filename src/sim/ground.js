// The ground under the airplane: its height and what it is made of. For now
// one flat, hard field at a fixed height; the island replaces it. No browser code.

// Friction, as a fraction of the weight on a wheel or a scraping point.
export const SURFACES = {
  runway: { mu_roll: 0.02, mu_side: 0.7, mu_brake: 0.6, mu_skid: 0.5 },
};

/** A flat field at `height` metres above sea level. */
export function flatGround(height = 0) {
  return { heightAt: () => height, surfaceAt: () => 'runway', surfaces: SURFACES };
}

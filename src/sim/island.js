// The island's land: its height anywhere, read from the height map in
// terrain/ (written by terrain/make-island.mjs). The same map serves the
// flight model and the picture, so what is seen is what is hit. After
// 135crewdog/rage, src/render/heightmap.js, cut down to one tile with no
// latitude or longitude. Metres; north and east of the island's middle.
// No browser code.

import { SURFACES } from './ground.js';

// The picture draws its finest ground in squares this many to a post, with
// their corners on the posts' own lines (src/render/terrain.js). The land
// between posts is straight-line joined, with a crease along each line of
// posts; squares that sit on those lines put their own edges on the creases,
// so the drawn ground near the airplane is the ground the flight model feels.
export const DRAWN_CELLS_PER_POST = 8;

/**
 * The heights of an image's pixels, as whole steps above the map's lowest
 * point: the red channel is the high byte and the green the low. `channels`
 * is 3 for RGB bytes and 4 for a canvas's RGBA.
 */
export function decodeHeights(bytes, count, channels = 4) {
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes[i * channels] * 256 + bytes[i * channels + 1];
  return out;
}

/**
 * How tall the woods stand over each pixel, in the map's canopy steps: the
 * blue channel. Zero is open ground.
 */
export function decodeCanopy(bytes, count, channels = 4) {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes[i * channels + 2];
  return out;
}

/**
 * region: terrain/island.json. heights: from decodeHeights. canopy: from
 * decodeCanopy. Returns { heightAt, waterAt, canopyAt }, each of (north,
 * east): the land's height; the level of the water standing there (the sea
 * is 0), or null on dry land; and how far the treetops stand above the land
 * (0 on open ground). Beyond the map's edge it is open sea.
 */
export function createIsland(region, heights, canopy = null) {
  const { size, post, north0, east0, min, step, lochs } = region;
  const at = (row, col) => min + heights[row * size + col] * step;
  // Straight lines between the posts, both ways; `beyond` is the answer off the map.
  function between(read, beyond, north, east) {
    const fr = (north0 - north) / post, fc = (east - east0) / post;   // row 0 is the north edge, column 0 the west
    if (fr < 0 || fc < 0 || fr > size - 1 || fc > size - 1) return beyond;
    const r = Math.min(size - 2, Math.floor(fr)), c = Math.min(size - 2, Math.floor(fc)), tr = fr - r, tc = fc - c;
    return (read(r, c) * (1 - tc) + read(r, c + 1) * tc) * (1 - tr) + (read(r + 1, c) * (1 - tc) + read(r + 1, c + 1) * tc) * tr;
  }
  const heightAt = (north, east) => between(at, region.seabed, north, east);
  const tops = (row, col) => canopy[row * size + col] * region.canopyStep;
  const canopyAt = canopy ? (north, east) => between(tops, 0, north, east) : () => 0;
  // A loch is the water below its level inside its box; everywhere, the sea is the water below zero.
  function waterAt(north, east) {
    const h = heightAt(north, east);
    for (const l of lochs) if (north > l.south && north < l.north && east > l.west && east < l.east && h < l.level) return l.level;
    return h < 0 ? 0 : null;
  }
  return { heightAt, waterAt, canopyAt };
}

/**
 * The island as the flight model's ground. Water stands as a surface at its
 * own level: the sea at zero, a loch at the loch's. A wood is solid at its
 * treetops, as one block.
 */
const WOOD = 1;   // m: treetops this far above the land are a wood underfoot

export function islandGround(island) {
  return {
    heightAt: (north, east) => Math.max(island.heightAt(north, east) + island.canopyAt(north, east), island.waterAt(north, east) ?? -Infinity),
    surfaceAt: (north, east) => (island.waterAt(north, east) !== null ? 'water' : island.canopyAt(north, east) > WOOD ? 'woods' : 'runway'),
    surfaces: SURFACES,
  };
}

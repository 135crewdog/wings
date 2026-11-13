// The island's land: its height anywhere, read from the height map in
// terrain/ (written by terrain/make-island.mjs). The same map serves the
// flight model and the picture, so what is seen is what is hit. After
// 135crewdog/rage, src/render/heightmap.js, cut down to one tile with no
// latitude or longitude. Metres; north and east of the island's middle.
// No browser code.

import { SURFACES } from './ground.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

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

export const RIVER = 255;   // in the blue channel, this marks a pixel in the river

/**
 * What stands on each pixel, from the blue channel: how tall the woods are,
 * in the map's canopy steps; 0 for open ground; or RIVER.
 */
export function decodeCanopy(bytes, count, channels = 4) {
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes[i * channels + 2];
  return out;
}

/** country.png's pixels as they are: desert, lava and farmland in its three channels, 0..255. */
export function decodeCountry(bytes, count, channels = 4) {
  const out = new Uint8Array(count * 3);
  for (let i = 0; i < count; i++) for (let k = 0; k < 3; k++) out[i * 3 + k] = bytes[i * channels + k];
  return out;
}

/**
 * region: terrain/island.json. heights: from decodeHeights. canopy: from
 * decodeCanopy. country: from decodeCountry. Returns the island's land,
 * each of (north, east):
 *   heightAt   the land's height
 *   canopyAt   how far the treetops stand above the land (0 on open ground)
 *   waterAt    the level of the water standing there (the sea is 0, the
 *              river lies on its bed), or null where there is none
 *   lavaAt     the level of the lava there (the lake in the crater, or a
 *              flow running down on the ground), or null
 *   countryAt  { desert, lava, farm }, each 0..1: what kind of country it is
 * Beyond the map's edge it is open sea.
 */
export function createIsland(region, heights, canopy = null, country = null) {
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
  const tops = (row, col) => { const v = canopy[row * size + col]; return v === RIVER ? 0 : v * region.canopyStep; };
  const wet = (row, col) => (canopy[row * size + col] === RIVER ? 1 : 0);
  const canopyAt = canopy ? (north, east) => between(tops, 0, north, east) : () => 0;
  const inRiver = canopy ? (north, east) => between(wet, 0, north, east) > 0.5 : () => false;
  // A pool is what lies below its level inside its box: the loch, and the lava lake.
  const pool = (kind, north, east, h) => {
    for (const l of lochs) if (l.kind === kind && north > l.south && north < l.north && east > l.west && east < l.east && h < l.level) return l.level;
    return null;
  };
  function waterAt(north, east) {
    const h = heightAt(north, east), level = pool('water', north, east, h);
    if (level !== null) return level;
    if (h < 0) return 0;                       // the sea
    return inRiver(north, east) ? h : null;    // the river lies on its bed
  }
  // Running lava lies on the ground along each flow's course, from the crater to the sea.
  const nearCourse = (course, north, east, within) => {
    for (let i = 0; i < course.length - 1; i++) {
      const [an, ae] = course[i], [bn, be] = course[i + 1], dn = bn - an, de = be - ae;
      const t = clamp(((north - an) * dn + (east - ae) * de) / (dn * dn + de * de), 0, 1);
      if (Math.hypot(north - an - t * dn, east - ae - t * de) < within) return true;
    }
    return false;
  };
  function lavaAt(north, east) {
    const h = heightAt(north, east), level = pool('lava', north, east, h);
    if (level !== null) return level;
    return h > 0 && (region.flows ?? []).some((course) => nearCourse(course, north, east, region.flowHalf)) ? h : null;
  }
  // country.png covers the same square as the height map, in fewer pixels.
  const side = country ? Math.sqrt(country.length / 3) : 0, span = (size - 1) * post;
  function countryAt(north, east) {
    if (!country) return { desert: 0, lava: 0, farm: 0 };
    const fr = clamp(((north0 - north) / span) * (side - 1), 0, side - 1), fc = clamp(((east - east0) / span) * (side - 1), 0, side - 1);
    const r = Math.min(side - 2, Math.floor(fr)), c = Math.min(side - 2, Math.floor(fc)), tr = fr - r, tc = fc - c;
    const mixed = [0, 1, 2].map((k) => {
      const px = (row, col) => country[(row * side + col) * 3 + k];
      return ((px(r, c) * (1 - tc) + px(r, c + 1) * tc) * (1 - tr) + (px(r + 1, c) * (1 - tc) + px(r + 1, c + 1) * tc) * tr) / 255;
    });
    return { desert: mixed[0], lava: mixed[1], farm: mixed[2] };
  }
  return { heightAt, waterAt, lavaAt, canopyAt, countryAt };
}

const WOOD = 1;   // m: treetops this far above the land are a wood underfoot

/**
 * The island as the flight model's ground. Water and lava stand as surfaces
 * at their own levels. A wood is solid at its treetops, as one block.
 * solids: the landmarks' solid shapes, from createSolids (src/sim/solids.js), when there are any.
 */
export function islandGround(island, solids = null) {
  return {
    ...(solids ? { solidBetween: solids.between } : {}),
    heightAt: (north, east) => Math.max(island.heightAt(north, east) + island.canopyAt(north, east), island.waterAt(north, east) ?? -Infinity, island.lavaAt(north, east) ?? -Infinity),
    surfaceAt: (north, east) => (island.lavaAt(north, east) !== null ? 'lava' : island.waterAt(north, east) !== null ? 'water' : island.canopyAt(north, east) > WOOD ? 'woods' : 'runway'),
    surfaces: SURFACES,
  };
}

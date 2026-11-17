// Hawaii's ground, for the flight model: heights and water from the tiles
// terrain/make-hawaii.py writes (docs/hawaii.md). No browser code: the tiles
// arrive already decoded, from the app (src/hawaii.js) or from a test, and the
// picture reads the very same posts, so what is seen is what is hit.
//
// The tiles make a pyramid. Level 0 has a post every `post` metres (10), in
// tiles of `tile` posts a side (256); each level up has half the posts each
// way. A post is the middle of its square. Tile (i, j) at level l covers
// north from i·S to (i+1)·S and east from j·S to (j+1)·S, S = tile·post·2^l,
// with its row 0 along its north edge. A tile that isn't in the index is open
// sea. North and east are metres from the threshold of runway 8R at Honolulu.

import { SURFACES } from './ground.js';

/** A tile's posts, from its height picture's red, green and blue bytes (4 a post, as a canvas gives them, or 3). */
export function decodeTile(bytes, index, stride = 4) {
  const n = index.tile * index.tile;
  const height = new Float32Array(n), water = new Uint8Array(n);
  for (let k = 0; k < n; k++) {
    height[k] = index.min + (bytes[k * stride] * 256 + bytes[k * stride + 1]) * index.step;
    water[k] = bytes[k * stride + 2] > 127 ? 1 : 0;
  }
  return { height, water };
}

/**
 * The ground the flight model needs (src/sim/contact.js): heightAt and
 * surfaceAt at (north, east), from the finest level whose tiles are at hand.
 * `tileAt(level, i, j)` returns a decoded tile ({ height, water }), null for
 * open sea, or undefined if it isn't loaded yet; then a coarser level answers.
 */
export function createHawaii(index, tileAt) {
  const { tile, post, levels } = index;
  // The four posts round a point at one level, or null if any is not at hand.
  const around = (level, north, east) => {
    const p = post * 2 ** level;
    // Every post in the world numbered: column C counts east, row R counts
    // south, post (R, C) at north -(R + 0.5)·p, east (C + 0.5)·p. Row r of
    // tile i is world row R = r - (i + 1)·tile, so tiles count north while
    // rows count south.
    const x = east / p - 0.5, y = -north / p - 0.5;
    const c0 = Math.floor(x), r0 = Math.floor(y);
    const fx = x - c0, fy = y - r0;
    const out = [];
    for (const [R, C] of [[r0, c0], [r0, c0 + 1], [r0 + 1, c0], [r0 + 1, c0 + 1]]) {
      const i = -Math.floor(R / tile) - 1, row = R + (i + 1) * tile;
      const j = Math.floor(C / tile), col = C - j * tile;
      const t = tileAt(level, i, j);
      if (t === undefined) return null;
      out.push(t === null ? { h: 0, w: 1 } : { h: t.height[row * tile + col], w: t.water[row * tile + col] });
    }
    return { posts: out, fx, fy };
  };
  const finest = (north, east) => {
    for (let level = 0; level < levels; level++) {
      const a = around(level, north, east);
      if (a) return a;
    }
    return { posts: [{ h: 0, w: 1 }, { h: 0, w: 1 }, { h: 0, w: 1 }, { h: 0, w: 1 }], fx: 0, fy: 0 };
  };
  const mix = (a, b, f) => a + (b - a) * f;
  return {
    /** Metres above sea level: straight lines between posts, as the picture draws it. */
    heightAt(north, east) {
      const { posts: [a, b, c, d], fx, fy } = finest(north, east);
      return mix(mix(a.h, b.h, fx), mix(c.h, d.h, fx), fy);
    },
    /** Water where the nearest post is water, else firm ground. */
    surfaceAt(north, east) {
      const { posts, fx, fy } = finest(north, east);
      return posts[(fy < 0.5 ? 0 : 2) + (fx < 0.5 ? 0 : 1)].w ? 'water' : 'runway';
    },
    surfaces: SURFACES,
  };
}

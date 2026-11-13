// The island, drawn: the land's height map as a geometry clipmap, the usual
// way to put a big landscape on a small device. Nested square grids with the
// same number of cells but doubling in size follow the camera, each snapped
// to its own grid so nothing swims, each with a hole where the finer one
// sits. The vertex shader lifts each vertex to the height read from the map,
// the same reading src/sim/island.js makes for the flight model, so what is
// seen is what is hit. The grids are placed relative to the camera, so the
// picture stays sharp far from the island's middle.
//
// The clipmap is 135crewdog/rage's (src/render/terrain.js). The paint is new:
// Rage colours its ground from satellite photographs; this island is painted
// by rule, flat-shaded, to match the airplane (docs/island.md).
// Metres; x east, y up, z south.

import * as THREE from 'three';
import { DRAWN_CELLS_PER_POST } from '../sim/island.js';

const LEVELS = 8;      // with 5.5 m cells at the finest: 0.5, 1.1, 2.1, 4.2, 8.4, 17, 34 and 68 km across
const N = 96;          // cells along each side of every level

// Reading the height map, as src/sim/island.js does: 16-bit posts in red and
// green, straight lines between them, open sea beyond the map's edge. And the
// water: the sea at zero, the loch at its level inside its box.
const LAND_GLSL = `
  uniform sampler2D heightMap;
  uniform vec4 grid;       // the north-west post's x and z, metres between posts, posts along a side
  uniform vec2 range;      // the lowest height, and metres per step
  uniform vec4 lochBox;    // west, north edge's z, east, south edge's z
  uniform float lochLevel;
  float post(vec2 ij) { vec4 t = texture2D(heightMap, (ij + 0.5) / grid.w); return range.x + (t.r * 65280.0 + t.g * 255.0) * range.y; }
  float land(vec2 xz) {
    vec2 p = (xz - grid.xy) / grid.z;
    if (p.x < 0.0 || p.y < 0.0 || p.x > grid.w - 1.0 || p.y > grid.w - 1.0) return range.x;
    vec2 i = min(floor(p), grid.w - 2.0), f = p - i;
    return mix(mix(post(i), post(i + vec2(1.0, 0.0)), f.x), mix(post(i + vec2(0.0, 1.0)), post(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // The level of the water standing over ground of height h at xz; far below everything on dry land.
  float water(vec2 xz, float h) {
    if (xz.x > lochBox.x && xz.x < lochBox.z && xz.y > lochBox.y && xz.y < lochBox.w && h < lochLevel) return lochLevel;
    return h < 0.0 ? 0.0 : -1.0e5;
  }
  float surface(vec2 xz) { float h = land(xz); return max(h, water(xz, h)); }`;

const vertexShader = `${LAND_GLSL}
  uniform vec2 rel;       // the level's middle, from the camera
  uniform float spacing;
  attribute vec2 edge;    // on a level's outer edge, halfway between two of the coarser level's posts: take their average, so levels meet without cracks
  varying vec3 wp;        // where in the world
  varying vec3 rp;        // where from the camera
  void main() {
    vec2 r = rel + position.xz * spacing;
    vec2 xz = cameraPosition.xz + r;
    float h = (edge.x != 0.0 || edge.y != 0.0) ? 0.5 * (surface(xz - edge * spacing) + surface(xz + edge * spacing)) : surface(xz);
    wp = vec3(xz.x, h, xz.y);
    rp = vec3(r.x, h - cameraPosition.y, r.y);
    gl_Position = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(rp, 1.0);
  }`;

const fragmentShader = `${LAND_GLSL}
  uniform vec3 sun, haze; uniform float hazeNear, hazeFar;
  uniform vec2 paint;     // farmland lies east of x; the chalk cliffs south of z
  uniform vec4 airfield;  // the runway's middle (x, z) and the way it runs (x, z)
  varying vec3 wp, rp;
  float rand(vec2 p, float s) { return fract(sin(dot(p, vec2(127.1, 311.7)) + s * 53.7) * 43758.5453); }
  float bend(vec2 p, float s) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return 2.0 * mix(mix(rand(i, s), rand(i + vec2(1.0, 0.0), s), f.x), mix(rand(i + vec2(0.0, 1.0), s), rand(i + vec2(1.0, 1.0), s), f.x), f.y) - 1.0;
  }
  vec3 crop(float pick) {
    if (pick < 0.15) return vec3(0.376, 0.588, 0.275);
    if (pick < 0.30) return vec3(0.478, 0.659, 0.306);
    if (pick < 0.45) return vec3(0.588, 0.675, 0.329);
    if (pick < 0.60) return vec3(0.690, 0.698, 0.376);
    if (pick < 0.72) return vec3(0.549, 0.486, 0.298);
    if (pick < 0.86) return vec3(0.329, 0.533, 0.259);
    return vec3(0.643, 0.588, 0.345);
  }
  // Farmland: plots with four sides, more or less. The land is cut into long strips of uneven width, each strip
  // is cut across at uneven spacings and its own slant, and the whole pattern bends gently, so few plots are true
  // rectangles. Each plot is one flat colour with faint crop rows; a track runs between plots; a few are woods.
  // n and e are metres north and east; far is how far off, to fade the fine lines before they shimmer.
  vec3 fields(float n, float e, float far) {
    const float STRIP = 520.0;
    float u = n * 0.94 + e * 0.34 + 260.0 * bend(vec2(n, e) / 2600.0, 6.0), v = -n * 0.34 + e * 0.94 + 260.0 * bend(vec2(n, e) / 2600.0, 7.0);
    float i = floor(u / STRIP);
    float lo = (i + 0.35 * (rand(vec2(i, 0.0), 8.0) - 0.5)) * STRIP;
    if (u < lo) { i -= 1.0; lo = (i + 0.35 * (rand(vec2(i, 0.0), 8.0) - 0.5)) * STRIP; }
    float hi = (i + 1.0 + 0.35 * (rand(vec2(i + 1.0, 0.0), 8.0) - 0.5)) * STRIP;
    if (u >= hi) { i += 1.0; lo = hi; hi = (i + 1.0 + 0.35 * (rand(vec2(i + 1.0, 0.0), 8.0) - 0.5)) * STRIP; }
    float len = 420.0 + 520.0 * rand(vec2(i, 1.0), 9.0);
    float w = v + (rand(vec2(i, 2.0), 9.0) - 0.5) * 0.5 * (u - lo) + rand(vec2(i, 3.0), 9.0) * len;
    float j = floor(w / len);
    float a = (j + 0.4 * (rand(vec2(i, j), 10.0) - 0.5)) * len;
    if (w < a) { j -= 1.0; a = (j + 0.4 * (rand(vec2(i, j), 10.0) - 0.5)) * len; }
    float b = (j + 1.0 + 0.4 * (rand(vec2(i, j + 1.0), 10.0) - 0.5)) * len;
    if (w >= b) { j += 1.0; a = b; b = (j + 1.0 + 0.4 * (rand(vec2(i, j + 1.0), 10.0) - 0.5)) * len; }
    vec2 plot = vec2(i, j);
    vec3 c = rand(plot, 3.0) < 0.07 ? vec3(0.204, 0.361, 0.188) : crop(rand(plot, 5.0));
    float rows = rand(plot, 4.0) < 0.5 ? u : w;
    c *= mix(sin(rows * 1.3) > 0.0 ? 1.0 : 0.95, 0.975, smoothstep(150.0, 700.0, far));          // crop rows, close up
    float side = min(min(u - lo, hi - u), min(w - a, b - w));
    float track = 4.5 + far * 0.0012;                                                              // the track keeps a little width far off
    return mix(vec3(0.659, 0.549, 0.376), c, smoothstep(track, track + 0.5 + far * 0.0012, side));
  }
  void main() {
    float far = length(rp);
    float h = land(wp.xz), level = water(wp.xz, h);
    vec3 c;
    if (level > h) {
      // Water: the sea paler in the shallows, the loch dark.
      c = level > 0.0 ? vec3(0.204, 0.361, 0.502) : mix(vec3(0.275, 0.510, 0.667), vec3(0.157, 0.353, 0.549), clamp(-h / 25.0, 0.0, 1.0));
    } else {
      // Flat shading: each triangle of the height map's own grid is lit as one face, whatever the distance.
      vec2 p = clamp((wp.xz - grid.xy) / grid.z, vec2(0.0), vec2(grid.w - 1.001));
      vec2 i = floor(p), f = p - i;
      float h00 = post(i), h10 = post(i + vec2(1.0, 0.0)), h01 = post(i + vec2(0.0, 1.0)), h11 = post(i + vec2(1.0, 1.0));
      vec3 n = normalize(f.x + f.y < 1.0 ? vec3(h00 - h10, grid.z, h00 - h01) : vec3(h01 - h11, grid.z, h10 - h11));
      float slope = length(n.xz) / n.y;
      // The paint, by rule: grass; farmland on low flat ground in the east; moor on the hills; rock high up and
      // on steep faces; chalk on the southern cliffs; sand at the shore.
      c = vec3(0.439, 0.588, 0.322);
      vec2 fromBase = wp.xz - airfield.xy;
      bool mown = abs(dot(fromBase, airfield.zw)) < 2100.0 && abs(dot(fromBase, vec2(-airfield.w, airfield.z))) < 450.0;   // the airfield's own grass
      if (wp.x > paint.x && h < 60.0 && slope < 0.12 && !mown) c = fields(-wp.z, wp.x, far);
      c = mix(c, vec3(0.502, 0.463, 0.345), clamp((h - 150.0) / 500.0, 0.0, 1.0));
      c = mix(c, vec3(0.471, 0.455, 0.439), clamp(max((h - 1100.0) / 700.0, (slope - 0.45) / 0.3), 0.0, 1.0));
      if (wp.z > paint.y && slope > 0.5) c = vec3(0.910, 0.902, 0.863);
      if (h < 3.0) c = mix(vec3(0.839, 0.784, 0.627), c, h / 3.0);
      c *= 0.68 + 0.5 * max(dot(n, sun), 0.0);
    }
    gl_FragColor = vec4(mix(c, haze, smoothstep(hazeNear, hazeFar, far)), 1.0);
  }`;

// One level's grid: (N+1) by (N+1) vertices in cell units, with the edge
// attribute, and four index sets for the four places the finer level's hole
// can sit.
function levelGeometry(withHole) {
  const positions = [], edges = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      positions.push(i - N / 2, 0, j - N / 2);
      const onX = j === 0 || j === N, onZ = i === 0 || i === N;
      edges.push(onX && i % 2 === 1 ? 1 : 0, onZ && j % 2 === 1 ? 1 : 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('edge', new THREE.Float32BufferAttribute(edges, 2));
  const variants = [];
  for (const dy of [0, 1]) {
    for (const dx of [0, 1]) {
      const index = [];
      for (let j = 0; j < N; j++) {
        for (let i = 0; i < N; i++) {
          if (withHole && i >= N / 4 + dx && i < (3 * N) / 4 + dx && j >= N / 4 + dy && j < (3 * N) / 4 + dy) continue;
          const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
          index.push(a, c, b, b, c, d);
        }
      }
      variants.push(new THREE.Uint32BufferAttribute(index, 1));
    }
  }
  geometry.setIndex(variants[0]);
  return { geometry, variants };
}

/**
 * Draws the island into a scene. `land` is { region, image } from
 * src/land.js; `sun` is the way to the sun; `fog` the scene's haze.
 * Returns { follow(camera) }: call it each frame.
 */
export function createTerrain(scene, land, sun, fog) {
  const { region } = land;
  const map = new THREE.Texture(land.image);
  map.magFilter = map.minFilter = THREE.NearestFilter;   // the posts are read one by one and joined in the shader
  map.generateMipmaps = false;
  map.flipY = false;                                     // row 0 is the north edge
  map.colorSpace = THREE.NoColorSpace;
  map.needsUpdate = true;
  const loch = region.lochs[0], base = region.sites.base;
  // The finest cells are a whole fraction of a post, and every level snaps to whole cells from the island's
  // middle, where the posts' lines also fall: so the fine levels' edges lie along the land's creases.
  const SPACING = region.post / DRAWN_CELLS_PER_POST;
  const shared = {
    heightMap: { value: map },
    grid: { value: new THREE.Vector4(region.east0, -region.north0, region.post, region.size) },
    range: { value: new THREE.Vector2(region.min, region.step) },
    lochBox: { value: new THREE.Vector4(loch.west, -loch.north, loch.east, -loch.south) }, lochLevel: { value: loch.level },
    paint: { value: new THREE.Vector2(region.paint.fieldsEast, -region.paint.chalkSouth) },
    airfield: { value: new THREE.Vector4(base.east, -base.north, Math.sin((base.heading * Math.PI) / 180), -Math.cos((base.heading * Math.PI) / 180)) },
    sun: { value: sun.clone().normalize() },
    haze: { value: fog.color.clone().convertLinearToSRGB() }, hazeNear: { value: fog.near }, hazeFar: { value: fog.far },   // the paint above is in screen colours
  };
  const levels = [];
  for (let l = 0; l < LEVELS; l++) {
    const { geometry, variants } = levelGeometry(l > 0);
    const material = new THREE.ShaderMaterial({ uniforms: { ...shared, rel: { value: new THREE.Vector2() }, spacing: { value: SPACING * 2 ** l } }, vertexShader, fragmentShader });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;   // the levels always surround the camera
    scene.add(mesh);
    levels.push({ mesh, variants, spacing: SPACING * 2 ** l });
  }
  return {
    // Put every level under the camera. Each snaps to twice its spacing, so
    // the finer level inside it lands on its grid, one cell over or not.
    follow(camera) {
      let finer = null;
      for (const level of levels) {
        const step = 2 * level.spacing;
        const cx = Math.floor(camera.position.x / step) * step, cz = Math.floor(camera.position.z / step) * step;
        level.mesh.material.uniforms.rel.value.set(cx - camera.position.x, cz - camera.position.z);
        if (finer) level.mesh.geometry.setIndex(level.variants[Math.round((finer.z - cz) / level.spacing) * 2 + Math.round((finer.x - cx) / level.spacing)]);
        finer = { x: cx, z: cz };
      }
    },
  };
}

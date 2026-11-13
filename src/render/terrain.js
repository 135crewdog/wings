// The island, drawn: the land's height map as a geometry clipmap, the usual
// way to put a big landscape on a small device. Nested square grids with the
// same number of cells but doubling in size follow the camera, each snapped
// to its own grid so nothing swims, each with a hole where the finer one
// sits. Toward its outer edge each level eases into the shape of the coarser
// one round it, so the land never jumps as the levels pass over it. The
// vertex shader lifts each vertex to the height read from the map,
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
// green, the treetops over them in blue (or the river's mark), straight lines
// between posts, open sea beyond the map's edge. And what stands on the land:
// the sea at zero, the loch and the lava lake at their levels inside their
// boxes, the river on its bed. A wood is drawn as it is flown: the ground
// stands taller there by the height of the trees.
const LAND_GLSL = `
  uniform sampler2D heightMap;
  uniform vec4 grid;       // the north-west post's x and z, metres between posts, posts along a side
  uniform vec3 range;      // the lowest height, metres per step, and metres per step of treetops
  uniform vec4 lochBox, lavaBox;    // west, north edge's z, east, south edge's z
  uniform float lochLevel, lavaLevel;
  // A post: the land's height, the treetops' height over it, and whether it is in the river (1 or 0).
  vec3 post(vec2 ij) {
    vec4 t = texture2D(heightMap, (ij + 0.5) / grid.w);
    float river = step(0.998, t.b);
    return vec3(range.x + (t.r * 65280.0 + t.g * 255.0) * range.y, (1.0 - river) * t.b * 255.0 * range.z, river);
  }
  vec3 ground(vec2 xz) {
    vec2 p = (xz - grid.xy) / grid.z;
    if (p.x < 0.0 || p.y < 0.0 || p.x > grid.w - 1.0 || p.y > grid.w - 1.0) return vec3(range.x, 0.0, 0.0);
    vec2 i = min(floor(p), grid.w - 2.0), f = p - i;
    return mix(mix(post(i), post(i + vec2(1.0, 0.0)), f.x), mix(post(i + vec2(0.0, 1.0)), post(i + vec2(1.0, 1.0)), f.x), f.y);
  }
  bool within(vec2 xz, vec4 box) { return xz.x > box.x && xz.x < box.z && xz.y > box.y && xz.y < box.w; }
  // The level of the loch, the lava lake or the sea standing over ground of height h at xz; far below everything on dry land.
  float pool(vec2 xz, float h) {
    if (within(xz, lochBox) && h < lochLevel) return lochLevel;
    if (within(xz, lavaBox) && h < lavaLevel) return lavaLevel;
    return h < 0.0 ? 0.0 : -1.0e5;
  }
  float surface(vec2 xz) { vec3 g = ground(xz); return max(g.x + g.y, pool(xz, g.x)); }`;

const vertexShader = `${LAND_GLSL}
  uniform vec2 rel;       // the level's middle, from the camera
  uniform float spacing;
  varying vec3 wp;        // where in the world
  varying vec3 rp;        // where from the camera
  void main() {
    vec2 r = rel + position.xz * spacing;
    vec2 xz = cameraPosition.xz + r;
    float h = surface(xz);
    // Easing into the coarser level. Every other vertex of this level is one of the coarser level's too. The
    // ones between lie on an edge of one of its triangles, half way between two of its vertices; "as the
    // coarser level has it" is the average of those two. From two-thirds of the way out, a vertex moves from
    // its own height toward that, and is there before the level's edge: no jump as the levels pass, no cracks
    // where they meet.
    float ease = clamp((max(abs(r.x), abs(r.y)) / spacing - EASE_FROM) / (EASE_TO - EASE_FROM), 0.0, 1.0);
    vec2 odd = mod(position.xz, 2.0);
    if (ease > 0.0 && odd.x + odd.y > 0.5) {
      vec2 o = odd.x * odd.y > 0.5 ? vec2(spacing, -spacing) : odd * spacing;   // in the middle of a coarse square: along the diagonal its two triangles share
      h = mix(h, 0.5 * (surface(xz - o) + surface(xz + o)), ease);
    }
    wp = vec3(xz.x, h, xz.y);
    rp = vec3(r.x, h - cameraPosition.y, r.y);
    gl_Position = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(rp, 1.0);
  }`;

const fragmentShader = `${LAND_GLSL}
  uniform vec3 sun, haze; uniform float hazeNear, hazeFar;
  uniform float clock;            // seconds, for what moves: the water and the lava
  uniform vec2 flows[FLOW_POINTS];   // each lava flow's course (x, z), one after the other, FLOW_LEGS legs each
  uniform float flowHalf;
  uniform sampler2D countryMap;   // desert in red, lava in green, farmland in blue
  uniform vec3 cove;      // the cove's middle (x, z), and how far its chalk reaches
  uniform vec4 airfield;  // the runway's middle (x, z) and the way it runs (x, z)
  varying vec3 wp, rp;
  // The same sum as src/fields.js's rand, whole number for whole number, so the plots painted here are the
  // plots the woods and the trees stand in.
  float rand(vec2 p, float s) {
    uint h = uint(int(p.x)) * 374761393u + uint(int(p.y)) * 668265263u + uint(int(s)) * 2147483647u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    return float(h ^ (h >> 16u)) / 4294967296.0;
  }
  float bend(vec2 p, float s) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return 2.0 * mix(mix(rand(i, s), rand(i + vec2(1.0, 0.0), s), f.x), mix(rand(i + vec2(0.0, 1.0), s), rand(i + vec2(1.0, 1.0), s), f.x), f.y) - 1.0;
  }
  vec3 crop(float pick) {   // one of seven, as src/fields.js counts them
    int k = int(pick * 7.0);
    if (k == 0) return vec3(0.376, 0.588, 0.275);
    if (k == 1) return vec3(0.478, 0.659, 0.306);
    if (k == 2) return vec3(0.588, 0.675, 0.329);
    if (k == 3) return vec3(0.690, 0.698, 0.376);
    if (k == 4) return vec3(0.549, 0.486, 0.298);
    if (k == 5) return vec3(0.329, 0.533, 0.259);
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
  // Water: the base colour with the things that tell a pilot how high he is. Patches of swell and small flecks,
  // each a fixed size on the water, so they grow as he comes down; the sun's glitter toward the sun; and the
  // sky's own colour in the water at a low angle. All of it drifts.
  vec3 wet(vec3 base, float far) {
    vec2 drift = clock * vec2(1.6, 0.7);
    float swell = bend((wp.xz + 5.0 * drift) / 85.0, 41.0), chop = bend((wp.xz - drift) / 11.0, 42.0);
    float mid = 1.0 - smoothstep(2500.0, 10000.0, far), near = 1.0 - smoothstep(500.0, 2600.0, far);
    vec3 c = base * (1.0 + mid * (step(0.1, swell) * 0.13 - 0.05));
    c = mix(c, base * 1.45 + 0.04, near * 0.55 * step(0.5, chop));
    vec3 v = normalize(-rp);
    float flash = pow(max(normalize(v + sun).y, 0.0), 90.0) * step(0.15, bend((wp.xz + 3.0 * drift) / 6.0, 43.0));
    c += vec3(1.0, 0.96, 0.82) * flash;
    return mix(c, haze, 0.4 * pow(1.0 - max(v.y, 0.0), 5.0));
  }
  // A forest, made of trees. From above, its top is a field of round crowns, each its own green, with dark gaps
  // between; on its steep sides, the edge of the wood, trunks stand in the shade under the crowns. "tall" is
  // how tall the trees are here, "up" how high this point is above the ground, "slope" how steep the face is.
  vec3 forest(float tall, float up, float slope, float far) {
    float size = tall > 40.0 ? 24.0 : 11.0;                   // a crown's width: redwoods are big trees
    vec2 cell = floor(wp.xz / size), best = vec2(9.0, 0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 k = cell + vec2(float(i), float(j));
      float d = distance(wp.xz / size, k + 0.5 + 0.7 * (vec2(rand(k, 51.0), rand(k, 52.0)) - 0.5));
      if (d < best.x) best = vec2(d, rand(k, 53.0));
    }
    vec3 dark = tall > 40.0 ? vec3(0.071, 0.196, 0.118) : vec3(0.110, 0.243, 0.125);
    vec3 crown = mix(dark * 1.9, dark * 2.9 + vec3(0.02, 0.04, 0.0), best.y);          // each tree its own green
    crown *= 1.0 - 0.35 * smoothstep(0.15, 0.55, best.x);                                // rounder: darker toward its rim
    vec3 top = mix(dark, crown, 1.0 - smoothstep(0.5, 0.62, best.x));                    // dark between the crowns
    top = mix(top, dark * 2.1, smoothstep(2500.0, 9000.0, far));                         // far off, one even green
    if (slope < 0.7) return top;
    // The side of the wood: trunks below, the crowns' skirt above.
    float along = dot(wp.xz, vec2(0.71, 0.71)) / (size * 0.42), trunk = step(0.62, fract(along + 0.3 * rand(vec2(floor(along), 0.0), 54.0)));
    vec3 bole = tall > 40.0 ? vec3(0.416, 0.243, 0.169) : vec3(0.290, 0.227, 0.165);
    vec3 under = mix(vec3(0.035, 0.07, 0.045), bole, trunk * (1.0 - smoothstep(1200.0, 5000.0, far)));
    return mix(under, top, smoothstep(0.5, 0.68, up / tall));
  }
  // Running lava: how far the point is from the nearest flow's middle, and how far down that flow it is.
  vec2 toFlow(vec2 xz) {
    float best = 1.0e9, along = 0.0;
    for (int k = 0; k < FLOW_COUNT; k++) {
      float run = 0.0;
      for (int i = 0; i < FLOW_LEGS; i++) {
        vec2 a = flows[k * (FLOW_LEGS + 1) + i], b = flows[k * (FLOW_LEGS + 1) + i + 1], ab = b - a;
        float t = clamp(dot(xz - a, ab) / dot(ab, ab), 0.0, 1.0), d = distance(xz, a + t * ab), leg = length(ab);
        if (d < best) { best = d; along = run + t * leg; }
        run += leg;
      }
    }
    return vec2(best, along);
  }
  void main() {
    float far = length(rp);
    vec3 here = ground(wp.xz);
    float h = here.x, level = pool(wp.xz, h);
    vec3 c;
    float glow = 0.0;
    if (level > h && level == lavaLevel && within(wp.xz, lavaBox)) {
      // The lava lake: bright, with a dark crust in plates. It shines through the haze.
      float crust = smoothstep(0.42, 0.5, 0.5 + 0.3 * bend(wp.xz / 90.0, 31.0) + 0.2 * bend(wp.xz / 23.0, 32.0));
      c = mix(vec3(1.0, 0.56, 0.1), vec3(0.42, 0.1, 0.04), crust);
      glow = 0.75;
    } else if (level > h) {
      // Water: the sea paler in the shallows, the loch dark.
      c = wet(level > 0.0 ? vec3(0.204, 0.361, 0.502) : mix(vec3(0.275, 0.510, 0.667), vec3(0.157, 0.353, 0.549), clamp(-h / 25.0, 0.0, 1.0)), far);
    } else if (here.z > 0.5) {
      c = wet(vec3(0.235, 0.431, 0.549), far);   // the river
    } else {
      // Flat shading: each triangle of the height map's own grid is lit as one face, whatever the distance.
      vec2 p = clamp((wp.xz - grid.xy) / grid.z, vec2(0.0), vec2(grid.w - 1.001));
      vec2 i = floor(p), f = p - i;
      vec3 g00 = post(i), g10 = post(i + vec2(1.0, 0.0)), g01 = post(i + vec2(0.0, 1.0)), g11 = post(i + vec2(1.0, 1.0));
      float h00 = g00.x + g00.y, h10 = g10.x + g10.y, h01 = g01.x + g01.y, h11 = g11.x + g11.y;   // lit as the treetops lie, where there are trees
      vec3 n = normalize(f.x + f.y < 1.0 ? vec3(h00 - h10, grid.z, h00 - h01) : vec3(h01 - h11, grid.z, h10 - h11));
      float slope = length(n.xz) / n.y;
      vec3 kind = texture2D(countryMap, (wp.xz - grid.xy) / ((grid.w - 1.0) * grid.z)).rgb;
      // The paint, by rule. Green country first: grass, farmland where the map says so on low flat ground, moor on
      // the hills, rock high up and on steep faces.
      c = vec3(0.439, 0.588, 0.322);
      vec2 fromBase = wp.xz - airfield.xy;
      bool mown = abs(dot(fromBase, airfield.zw)) < 2100.0 && abs(dot(fromBase, vec2(-airfield.w, airfield.z))) < 450.0;   // the airfield's own grass
      vec2 lie = (f.x + f.y < 1.0 ? vec2(g00.x - g10.x, g00.x - g01.x) : vec2(g01.x - g11.x, g10.x - g11.x)) / grid.z;   // the land's own slope, under any trees
      if (kind.b > 0.5 && h < 60.0 && length(lie) < 0.12 && !mown) c = fields(-wp.z, wp.x, far);
      c = mix(c, vec3(0.502, 0.463, 0.345), clamp((h - 150.0) / 500.0, 0.0, 1.0));
      c = mix(c, vec3(0.471, 0.455, 0.439), clamp(max((h - 1100.0) / 700.0, (slope - 0.45) / 0.3), 0.0, 1.0));
      // Desert: tan flats, and red rock in bands on the slopes, as strata.
      vec3 strata = mod(floor(h / 55.0), 2.0) > 0.5 ? vec3(0.769, 0.471, 0.306) : vec3(0.839, 0.588, 0.376);
      c = mix(c, mix(vec3(0.871, 0.722, 0.518), strata, clamp((slope - 0.12) / 0.2, 0.0, 1.0)), kind.r);
      // Lava: black, with rust on the steeps.
      c = mix(c, mix(vec3(0.149, 0.141, 0.149), vec3(0.275, 0.204, 0.180), clamp((slope - 0.2) / 0.5, 0.0, 1.0)), kind.g);
      // Chalk on the cliffs round the cove; sand at the shore, wide on the desert's coast.
      if (distance(wp.xz, cove.xy) < cove.z && slope > 0.5 && h < 160.0) c = vec3(0.910, 0.902, 0.863);
      if (h < 3.0 + 9.0 * kind.r) c = mix(vec3(0.910, 0.847, 0.675), c, clamp((h - 1.5 - 5.0 * kind.r) / 3.0, 0.0, 1.0));
      if (here.y > 1.0) c = forest(max(max(g00.y, g10.y), max(g01.y, g11.y)), here.y, slope, far);   // a wood or the redwoods: how tall the trees are, and how far up them this point is
      c *= 0.68 + 0.5 * max(dot(n, sun), 0.0);
      // Running lava, down each flow from the crater to the sea: a bright stream between dark banks, its crust
      // breaking into plates that ride downhill.
      if (kind.g > 0.2) {
        vec2 flow = toFlow(wp.xz);
        if (flow.x < flowHalf * 1.7) {
          float plates = smoothstep(0.38, 0.5, 0.5 + 0.32 * bend(vec2(flow.y - 9.0 * clock, flow.x * 2.0) / 38.0, 33.0) + 0.18 * bend(vec2(flow.y - 9.0 * clock, flow.x) / 9.0, 34.0));
          vec3 stream = mix(vec3(1.0, 0.6, 0.12), vec3(0.5, 0.12, 0.04), plates);
          float inStream = 1.0 - smoothstep(flowHalf * 0.75, flowHalf, flow.x);
          c = mix(vec3(0.09, 0.08, 0.08), stream, inStream);      // dark banks, then the stream
          glow = 0.7 * inStream;
        }
      }
    }
    gl_FragColor = vec4(mix(c, haze, smoothstep(hazeNear, hazeFar, far) * (1.0 - glow)), 1.0);
  }`;

// One level's grid: (N+1) by (N+1) vertices in cell units, and four index
// sets for the four places the finer level's hole can sit.
function levelGeometry(withHole) {
  const positions = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      positions.push(i - N / 2, 0, j - N / 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
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
 * Draws the island into a scene. `land` is { region, image, countryImage } from
 * src/land.js; `sun` is the way to the sun; `fog` the scene's haze.
 * Returns { follow(camera) }: call it each frame.
 */
export function createTerrain(scene, land, sun, fog) {
  const { region } = land;
  const texture = (image, filter) => {
    const t = new THREE.Texture(image);
    t.magFilter = t.minFilter = filter;
    t.generateMipmaps = false;
    t.flipY = false;                 // row 0 is the north edge
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const map = texture(land.image, THREE.NearestFilter);   // the posts are read one by one and joined in the shader
  const box = (l) => new THREE.Vector4(l.west, -l.north, l.east, -l.south);
  const loch = region.lochs.find((l) => l.kind === 'water'), lava = region.lochs.find((l) => l.kind === 'lava');
  const legs = region.flows[0].length - 1, flowPoints = region.flows.flat().map(([north, east]) => new THREE.Vector2(east, -north));
  // A level's edge is N/2 cells from its middle, and its middle is up to 2 cells from the camera: so it has
  // eased all the way by N/2 - 4 cells out, and starts well clear of the finer level's hole at N/4 + 3.
  const defines = { FLOW_COUNT: region.flows.length, FLOW_LEGS: legs, FLOW_POINTS: flowPoints.length, EASE_FROM: (N / 3).toFixed(1), EASE_TO: (N / 2 - 4).toFixed(1) };
  const clock = { value: 0 };
  const { base, cove } = region.sites;
  // The finest cells are a whole fraction of a post, and every level snaps to whole cells from the island's
  // middle, where the posts' lines also fall: so the fine levels' edges lie along the land's creases.
  const SPACING = region.post / DRAWN_CELLS_PER_POST;
  const shared = {
    heightMap: { value: map },
    grid: { value: new THREE.Vector4(region.east0, -region.north0, region.post, region.size) },
    range: { value: new THREE.Vector3(region.min, region.step, region.canopyStep) },
    lochBox: { value: box(loch) }, lochLevel: { value: loch.level }, lavaBox: { value: box(lava) }, lavaLevel: { value: lava.level },
    countryMap: { value: texture(land.countryImage, THREE.LinearFilter) },
    cove: { value: new THREE.Vector3(cove.east, -cove.north, 5000) },
    airfield: { value: new THREE.Vector4(base.east, -base.north, Math.sin((base.heading * Math.PI) / 180), -Math.cos((base.heading * Math.PI) / 180)) },
    flows: { value: flowPoints }, flowHalf: { value: region.flowHalf }, clock,
    sun: { value: sun.clone().normalize() },
    haze: { value: fog.color.clone().convertLinearToSRGB() }, hazeNear: { value: fog.near }, hazeFar: { value: fog.far },   // the paint above is in screen colours
  };
  const levels = [];
  for (let l = 0; l < LEVELS; l++) {
    const { geometry, variants } = levelGeometry(l > 0);
    const material = new THREE.ShaderMaterial({ defines, uniforms: { ...shared, rel: { value: new THREE.Vector2() }, spacing: { value: SPACING * 2 ** l } }, vertexShader, fragmentShader });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;   // the levels always surround the camera
    scene.add(mesh);
    levels.push({ mesh, variants, spacing: SPACING * 2 ** l });
  }
  return {
    // Put every level under the camera. Each snaps to twice its spacing, so
    // the finer level inside it lands on its grid, one cell over or not.
    follow(camera) {
      clock.value = (performance.now() / 1000) % 3600;   // kept small, so the drift stays smooth
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

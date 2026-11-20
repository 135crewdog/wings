// Hawaii, drawn. The ground is a geometry clipmap, the usual way to put a big
// landscape on a small device (from 135crewdog/rage, src/render/terrain.js;
// Losasso and Hoppe, 2004): nested square grids with the same number of
// cells, doubling in size, follow the camera, each snapped to its own grid so
// nothing swims, each with a hole where the finer one sits, easing into the
// coarser one toward its edge so nothing jumps or cracks. The grids are placed
// relative to the camera, so the picture stays sharp far from the origin.
//
// Far ground is drawn from coarser copies of the map, and a coarse grid cuts
// the tops off peaks and ridges. What keeps that out of sight is how many
// cells each grid has: enough (the textbook has 255; Wings has 320) that a grid is only
// ever drawn where its cells are small on the screen, so a summit is never
// more than a few pixels short at any distance (tests/hawaii.test.js). Each
// grid's triangles are stored in order round the camera, so only the slice of
// it the camera faces is drawn (the textbook's other half): the ground behind
// and beside the camera costs nothing. High above the ground, the finest
// grids are left out (as Losasso and Hoppe do): a grid whose whole width is
// less than twice the camera's height above the ground would be drawn only
// where its cells are too small to see, and the next coarser grid fills in.
//
// What's new is where the heights and colours come from. Hawaii is far too
// big to hold whole, so each level of the tile pyramid (terrain/hawaii/) has a
// window of WINDOW × WINDOW tiles round the camera on the GPU, in one layer of
// a texture array, and tiles stream into it as the camera moves: a tile always
// lands in the same place in its layer, wrapping round, so moving the window
// one tile only fills one row or column. Each level says which part of the
// world it holds whole; everything else is read from a coarser level, and
// beyond the islands it is the sea. The posts are read one by one and joined
// in straight lines, exactly as src/sim/hawaii.js joins them for the flight
// model, so what is seen is what is hit.
//
// The paint is Rage's: the satellite picture, a light grain up close, a
// gentle sun (the picture already carries the satellite's shading), Rage's
// water wherever the tiles say water, and haze.
// Metres; three.js axes: x east, y up, z south.

import * as THREE from 'three';

const MESH_LEVELS = 7;   // with 10 m cells at the finest: 3.2, 6.4, 13, 26, 51, 102 and 205 km across
const N = 320;           // cells along each side of every mesh level: enough to keep every summit within 5 pixels
const WINDOW = 4;        // tiles along each side of a level's window
const UPLOADS = 6;       // tiles put on the GPU each frame at most

// Value noise (Rage's), for the ground's grain, the water's ripple and the sky's clouds.
export const NOISE_GLSL = `
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }`;

const SAMPLE_GLSL = `
  uniform highp sampler2DArray heights;   // red and green: the height; blue: water
  uniform highp sampler2DArray colours;
  uniform vec4 held[LEVELS];             // what each level holds whole: west, north edge's z, east, south edge's z (all off: 0, 0, 0, 0)
  uniform vec3 code;                      // the height code: lowest height, metres a step, metres between level-0 posts
  const float SIZE = float(WINDOW * TILE);
  float postSpacing(int l) { return code.z * exp2(float(l)); }
  bool holds(int l, vec2 xz, float margin) {
    vec4 b = held[l];
    return xz.x > b.x + margin && xz.x < b.z - margin && xz.y > b.y + margin && xz.y < b.w - margin;
  }
  // A post's height and water at level l. Column counts east, row south, as in src/sim/hawaii.js.
  vec2 post(int l, vec2 cr) {
    vec4 t = texelFetch(heights, ivec3(int(mod(cr.x, SIZE)), int(mod(cr.y, SIZE)), l), 0);
    return vec2(code.x + (t.r * 65280.0 + t.g * 255.0) * code.y, t.b);
  }
  // Height and water at a point from level l, in straight lines between posts.
  vec2 groundAt(int l, vec2 xz) {
    float p = postSpacing(l);
    vec2 q = vec2(xz.x, xz.y) / p - 0.5;   // xz.y is south, so this is (column, row)
    vec2 i = floor(q), f = q - i;
    return mix(mix(post(l, i), post(l, i + vec2(1.0, 0.0)), f.x), mix(post(l, i + vec2(0.0, 1.0)), post(l, i + vec2(1.0, 1.0)), f.x), f.y);
  }
  // The finest level from l up that holds the point; -1 is the open sea.
  int levelFor(int l, vec2 xz) {
    for (int k = 0; k < LEVELS; k++) if (k >= l && holds(k, xz, 2.0 * postSpacing(k))) return k;
    return -1;
  }
  float heightFrom(int l, vec2 xz) {
    int k = levelFor(l, xz);
    return k < 0 ? 0.0 : groundAt(k, xz).x;
  }`;

const vertexShader = `${SAMPLE_GLSL}
  uniform vec2 rel;       // the mesh level's middle, from the camera
  uniform float spacing;
  uniform int level;      // which level of the pyramid this mesh level reads
  uniform int coarser;    // and which the next mesh level out reads
  varying vec3 wp;        // where in the world
  varying vec3 rp;        // where from the camera
  void main() {
    vec2 r = rel + position.xz * spacing;
    vec2 xz = cameraPosition.xz + r;
    float h = heightFrom(level, xz);
    // Easing into the coarser mesh level toward the edge: there every vertex
    // goes to where the coarser level has the ground, read from the coarser
    // level of the pyramid as that mesh level reads it. Every other vertex is
    // one of the coarser level's; the ones between lie half way along an edge
    // of its triangles, so they go to the average of its two ends.
    float ease = clamp((max(abs(r.x), abs(r.y)) / spacing - EASE_FROM) / (EASE_TO - EASE_FROM), 0.0, 1.0);
    if (ease > 0.0) {
      vec2 odd = mod(position.xz, 2.0);
      float coarse;
      if (odd.x + odd.y > 0.5) {
        vec2 o = odd.x * odd.y > 0.5 ? vec2(spacing, -spacing) : odd * spacing;
        coarse = 0.5 * (heightFrom(coarser, xz - o) + heightFrom(coarser, xz + o));
      } else {
        coarse = heightFrom(coarser, xz);
      }
      h = mix(h, coarse, ease);
    }
    wp = vec3(xz.x, h, xz.y);
    rp = vec3(r.x, h - cameraPosition.y, r.y);
    gl_Position = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(rp, 1.0);
  }`;

const fragmentShader = `${SAMPLE_GLSL}
  uniform vec3 sun, fogColor; uniform float fogNear, fogFar;
  varying vec3 wp, rp;
  ${NOISE_GLSL}
  vec3 colourAt(int l, vec2 xz) {
    vec2 q = xz / postSpacing(l);   // the colour is a picture: the GPU joins its pixels itself
    return textureLod(colours, vec3(q / SIZE, float(l)), 0.0).rgb;   // the layers have no smaller copies
  }
  void main() {
    // The level to paint from: about one post to a pixel, as a picture's
    // smaller copies would be chosen, and between two levels a blend.
    float footprint = max(length(dFdx(wp.xz)), length(dFdy(wp.xz)));
    float want = clamp(log2(max(footprint, 1e-3) / code.z), 0.0, float(LEVELS - 1));
    // Ground the haze hides entirely is the haze's colour: none of the painting below is needed.
    float dist = length(rp);
    if (dist >= fogFar) { gl_FragColor = vec4(fogColor, 1.0); return; }
    int l = levelFor(int(floor(want)), wp.xz);
    vec3 c = vec3(0.0); float water = 1.0; vec3 n = vec3(0.0, 1.0, 0.0);
    if (l >= 0) water = smoothstep(0.35, 0.65, groundAt(l, wp.xz).y);
    // Where the water is solid it covers the land entirely: none of the land's painting is needed.
    if (l >= 0 && water < 1.0) {
      int l2 = levelFor(l + 1, wp.xz);
      float blend = l2 > l ? clamp(want - float(l), 0.0, 1.0) : 0.0;
      c = colourAt(l, wp.xz);
      if (blend > 0.0) c = mix(c, colourAt(l2, wp.xz), blend);
      // The slope from the posts on either side, at the level painted from.
      float p = postSpacing(l);
      float hx = groundAt(l, wp.xz + vec2(p, 0.0)).x - groundAt(l, wp.xz - vec2(p, 0.0)).x;
      float hz = groundAt(l, wp.xz + vec2(0.0, p)).x - groundAt(l, wp.xz - vec2(0.0, p)).x;
      n = normalize(vec3(-hx, 2.0 * p, -hz));
      // A light grain at two scales so the ground reads as moving at low level, fading before it shimmers (and not worked out once it has).
      float faded = smoothstep(1500.0, 6000.0, dist);
      c *= faded < 1.0 ? mix(0.9 + 0.1 * (0.6 * noise(wp.xz / 50.0) + 0.4 * noise(wp.xz / 7.0)), 0.95, faded) : 0.95;
      // Lit by the sun, gently: the pictures carry the satellite's own shading.
      c *= max(dot(n, sun), 0.0) * 0.45 + 0.72;
    }
    if (water > 0.0) {
      // Rage's water: deep blue, the sky in it at a low angle, the sun's glint, a faint ripple.
      float ripple = 1.0 - smoothstep(500.0, 3000.0, dist);   // the ripple is gone before it makes rings in the distance
      vec2 rip = ripple > 0.0 ? (vec2(noise(wp.xz / 9.0 + 3.0), noise(wp.xz / 9.0 + 11.0)) - 0.5) * ripple : vec2(0.0);
      vec3 nw = normalize(vec3(rip.x * 0.06, 1.0, rip.y * 0.06));
      vec3 v = normalize(-rp);
      float grazing = pow(1.0 - max(dot(nw, v), 0.0), 3.0);
      vec3 cw = mix(vec3(0.07, 0.22, 0.30), fogColor, 0.15 + 0.55 * grazing);
      cw += vec3(1.0, 0.95, 0.85) * 0.7 * pow(max(dot(nw, normalize(v + sun)), 0.0), 90.0);
      c = mix(c, cw, water);
    }
    gl_FragColor = vec4(mix(c, fogColor, smoothstep(fogNear, fogFar, dist)), 1.0);
  }`;

// The grids. Every mesh level is a ring: (N+1) by (N+1) vertices in cell
// units with a hole where the finer level sits, and four index sets for the
// four places that hole can be. The finest ring's hole holds the core, a
// plain grid at the finest spacing, always drawn whole. Every ring shares the
// same vertices and index sets, so they are on the GPU once.
//
// A ring's triangles are sorted into SECTORS slices round its middle, by the
// direction of each cell from the camera, and the list is stored twice over,
// so any run of slices, even one that wraps past due west, is one unbroken
// stretch of it to draw.
const SECTORS = 32;
const grid = (n) => {
  const p = [];
  for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) p.push(i - n / 2, 0, j - n / 2);
  return new THREE.Float32BufferAttribute(p, 3);
};
const sectorOf = (x, z) => Math.floor(((Math.atan2(z, x) + Math.PI) / (2 * Math.PI)) * SECTORS) % SECTORS;
const positions = grid(N);
const rings = [];
for (const dy of [0, 1]) {
  for (const dx of [0, 1]) {
    const slices = Array.from({ length: SECTORS }, () => []);
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        if (i >= N / 4 + dx && i < (3 * N) / 4 + dx && j >= N / 4 + dy && j < (3 * N) / 4 + dy) continue;
        const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
        slices[sectorOf(i + 0.5 - N / 2, j + 0.5 - N / 2)].push(a, c, b, b, c, d);
      }
    }
    const once = slices.flat(), starts = [0];
    for (let k = 0; k < 2 * SECTORS; k++) starts.push(starts[k] + slices[k % SECTORS].length);
    rings.push({ index: new THREE.Uint32BufferAttribute([...once, ...once], 1), starts });
  }
}
const core = (() => {
  const n = N / 2, index = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i, b = a + 1, c = a + n + 1, d = c + 1;
      index.push(a, c, b, b, c, d);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', grid(n));
  geometry.setIndex(index);
  return geometry;
})();

/**
 * The slices of every ring the camera can see: [first, last] (last may run
 * past SECTORS, wrapping), or null when it can see them all. What the view
 * takes in is the fan of directions between its four corners; seen from
 * above, that is the arc between the four corners' compass directions, unless
 * the view holds straight down or straight up, when it is every direction.
 */
const toView = new THREE.Quaternion(), ray = new THREE.Vector3();
function sectorsInView(camera) {
  const ty = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom, tx = ty * camera.aspect;
  toView.copy(camera.quaternion).invert();
  for (const up of [1, -1]) {
    ray.set(0, up, 0).applyQuaternion(toView);
    if (ray.z < 0 && Math.abs(ray.x) <= -ray.z * tx && Math.abs(ray.y) <= -ray.z * ty) return null;
  }
  const angles = [];
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ray.set(sx * tx, sy * ty, -1).applyQuaternion(camera.quaternion);
      angles.push(Math.atan2(ray.z, ray.x));
    }
  }
  angles.sort((a, b) => a - b);
  // The arc is all the way round less the widest gap between corners.
  let gap = angles[0] + 2 * Math.PI - angles[3], start = angles[0];
  for (let k = 1; k < 4; k++) if (angles[k] - angles[k - 1] > gap) { gap = angles[k] - angles[k - 1]; start = angles[k]; }
  // A margin for the camera sitting up to two cells off a ring's middle, and a cell's own width.
  const margin = 16 / N + 0.05, toSlices = SECTORS / (2 * Math.PI);
  const first = mod((start - margin + Math.PI) * toSlices, SECTORS), width = (2 * Math.PI - gap + 2 * margin) * toSlices;
  if (width >= SECTORS - 1) return null;
  return [Math.floor(first), Math.floor(first + width)];
}

const mod = (a, n) => ((a % n) + n) % n;

/**
 * Draws Hawaii into a scene. `hawaii` is src/hawaii.js's; `sun` the way to
 * the sun; `fog` the scene's haze. Returns { follow(camera) }: call it each
 * frame before drawing.
 */
export function createTerrain(scene, renderer, hawaii, sun, fog) {
  const { index } = hawaii;
  const LEVELS = index.levels, TILE = index.tile, SIZE = WINDOW * TILE;
  const gl = renderer.getContext();
  // One layer a level, for the heights and for the colours. To start with
  // every texel is the open sea, so a level holds nothing until it is filled.
  const sea = new Uint8Array(SIZE * SIZE * LEVELS * 4), seaColour = new Uint8Array(SIZE * SIZE * LEVELS * 4);
  const seaCode = Math.round((0 - index.min) / index.step);
  for (let k = 0; k < SIZE * SIZE * LEVELS; k++) {
    sea.set([seaCode >> 8, seaCode & 255, 255, 255], k * 4);
    seaColour.set([16, 40, 70, 255], k * 4);
  }
  const array = (data, filter) => {
    const t = new THREE.DataArrayTexture(data, SIZE, SIZE, LEVELS);
    t.magFilter = t.minFilter = filter;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    t.needsUpdate = true;
    return t;
  };
  const heights = array(sea, THREE.NearestFilter), colours = array(seaColour, THREE.LinearFilter);
  const held = Array.from({ length: LEVELS }, () => new THREE.Vector4(0, 0, 0, 0));
  const shared = {
    heights: { value: heights }, colours: { value: colours }, held: { value: held },
    code: { value: new THREE.Vector3(index.min, index.step, index.post) },
    sun: { value: sun.clone().normalize() },
    fogColor: { value: fog.color.clone().convertLinearToSRGB() }, fogNear: { value: fog.near }, fogFar: { value: fog.far },
  };
  // A mesh level eases into the coarser one from a third of the way out, and has arrived by 4 cells from its edge.
  const defines = { LEVELS, TILE, WINDOW, EASE_FROM: (N / 3).toFixed(1), EASE_TO: (N / 2 - 4).toFixed(1) };
  const meshes = [];
  for (let m = 0; m < MESH_LEVELS; m++) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', positions);
    geometry.setIndex(rings[0].index);
    const spacing = index.post * 2 ** m;
    // Each mesh level reads the copy of the map whose posts are half its cells
    // (the nearest reads the finest, so what is seen is what is hit): every
    // vertex sits between four posts, so it is the ground averaged over one
    // cell, not four. The next level out reads the copy above.
    const reads = (k) => Math.min(Math.max(k - 1, 0), LEVELS - 1);
    const material = new THREE.ShaderMaterial({
      defines, uniforms: { ...shared, rel: { value: new THREE.Vector2() }, spacing: { value: spacing }, level: { value: reads(m) }, coarser: { value: reads(m + 1) } },
      vertexShader, fragmentShader,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;   // the levels always surround the camera
    scene.add(mesh);
    meshes.push({ mesh, spacing });
  }
  // The finest ring drawn has its hole filled by the core, read and placed as that ring is.
  const middle = new THREE.Mesh(core, meshes[0].mesh.material);
  middle.frustumCulled = false;
  scene.add(middle);

  // ---- the windows: which tiles each level has on the GPU ----
  // A level's window is WINDOW tiles each way from (i0, j0), its south-west
  // tile. While tiles of a new window arrive, it holds only what the old and
  // the new have in common.
  const windows = Array.from({ length: LEVELS }, () => ({ i0: null, j0: null, waiting: 0, loaded: new Set() }));
  const span = (l) => TILE * index.post * 2 ** l;
  const setHeld = (l, i0, j0, i1, j1) => {
    // Tiles i0..i1 north, j0..j1 east: west, north edge's z, east, south edge's z.
    if (i1 < i0 || j1 < j0) held[l].set(0, 0, 0, 0);
    else held[l].set(j0 * span(l), -(i1 + 1) * span(l), (j1 + 1) * span(l), -i0 * span(l));
  };
  const queue = [];
  // Puts a tile's picture (an ImageBitmap, or the sea's bytes) into its place in a level's layer.
  const put = (texture, layer, x, y, source) => {
    renderer.state.bindTexture(gl.TEXTURE_2D_ARRAY, renderer.properties.get(texture).__webglTexture);
    // Through three.js's own record of these settings, so its next upload (a runway's paint) is set as it expects.
    const { state } = renderer;
    state.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    state.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    state.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
    state.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, x, y, layer, TILE, TILE, 1, gl.RGBA, gl.UNSIGNED_BYTE, source);
  };
  // The open sea, for a tile that isn't in the index.
  const seaTile = { height: sea.subarray(0, TILE * TILE * 4), colour: seaColour.subarray(0, TILE * TILE * 4) };

  const move = (l, i0, j0) => {
    const w = windows[l];
    const fresh = [];
    for (let i = i0; i < i0 + WINDOW; i++) for (let j = j0; j < j0 + WINDOW; j++) fresh.push([i, j]);
    // What stays: the tiles both windows share.
    const keep = new Set(fresh.filter(([i, j]) => w.loaded.has(`${i}/${j}`)).map(([i, j]) => `${i}/${j}`));
    w.loaded = keep;
    w.i0 = i0; w.j0 = j0;
    const both = [...keep].map((k) => k.split('/').map(Number));
    if (both.length) {
      const is = both.map((t) => t[0]), js = both.map((t) => t[1]);
      setHeld(l, Math.min(...is), Math.min(...js), Math.max(...is), Math.max(...js));
    } else setHeld(l, 1, 1, 0, 0);
    const wanted = fresh.filter(([i, j]) => !keep.has(`${i}/${j}`));
    w.waiting = wanted.length;
    for (const [i, j] of wanted) {
      const ticket = { l, i, j, i0, j0, pictures: hawaii.has(l, i, j) ? null : seaTile };
      queue.push(ticket);
      if (!ticket.pictures) hawaii.pictures(l, i, j).then((p) => { ticket.pictures = p ?? seaTile; }, () => { ticket.pictures = seaTile; });
    }
  };

  const place = (ticket) => {
    const { l, i, j } = ticket, w = windows[l];
    if (ticket.i0 !== w.i0 || ticket.j0 !== w.j0) return true;   // the window moved on: drop it
    if (!renderer.properties.get(heights).__webglTexture || !renderer.properties.get(colours).__webglTexture) return false;
    const x = mod(j, WINDOW) * TILE, y = mod(-(i + 1), WINDOW) * TILE;
    const p = ticket.pictures;
    put(heights, l, x, y, p.height);
    put(colours, l, x, y, p.colour);
    if (p !== seaTile) { p.height.close(); p.colour.close(); }
    w.loaded.add(`${i}/${j}`);
    if (--w.waiting === 0) setHeld(l, w.i0, w.j0, w.i0 + WINDOW - 1, w.j0 + WINDOW - 1);
    return true;
  };

  // If the phone takes the GPU's memory away and gives it back, three.js
  // starts the layers again as open sea: every level holds nothing until
  // its window is filled again, which the next frame starts.
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    queue.length = 0;
    for (let l = 0; l < LEVELS; l++) {
      windows[l] = { i0: null, j0: null, waiting: 0, loaded: new Set() };
      held[l].set(0, 0, 0, 0);
    }
  });

  return {
    /** Puts every mesh level under the camera and brings the tiles round it. */
    follow(camera) {
      const north = -camera.position.z, east = camera.position.x;
      // The coarsest levels first, so there is always something to draw.
      for (let l = LEVELS - 1; l >= 0; l--) {
        const s = span(l);
        const i0 = Math.round(north / s) - WINDOW / 2, j0 = Math.round(east / s) - WINDOW / 2;
        const w = windows[l];
        if (w.i0 !== i0 || w.j0 !== j0) move(l, i0, j0);
      }
      let placed = 0;
      for (let k = 0; k < queue.length && placed < UPLOADS; ) {
        const ticket = queue[k];
        if (!ticket.pictures) { k++; continue; }
        if (!place(ticket)) break;   // the textures aren't on the GPU yet: the first frame draws them
        queue.splice(k, 1);
        placed++;
      }
      const view = sectorsInView(camera);
      // How far the camera can see: its far limit is a depth straight ahead, so toward a corner of the screen it sees farther.
      const ty = Math.tan((camera.fov * Math.PI) / 360) / camera.zoom, reach = camera.far * Math.hypot(1, ty * camera.aspect, ty);
      // The finest ring drawn: the first as wide as twice the camera's height above the ground under it.
      const above = camera.position.y - hawaii.ground.heightAt(-camera.position.z, camera.position.x);
      const wide = meshes.findIndex((m) => (N / 2) * m.spacing >= above), finest = wide < 0 ? meshes.length - 1 : wide;
      middle.material = meshes[finest].mesh.material;
      let finer = null;
      for (const [k, m] of meshes.entries()) {
        if (k < finest) { m.mesh.visible = false; continue; }
        const step = 2 * m.spacing;
        const cx = Math.floor(camera.position.x / step) * step, cz = Math.floor(camera.position.z / step) * step;
        m.mesh.material.uniforms.rel.value.set(cx - camera.position.x, cz - camera.position.z);
        // A ring that starts beyond the camera's reach (its hole sits up to two cells off the camera) is not drawn.
        m.mesh.visible = (N / 4 - 2) * m.spacing < reach;
        // The finest ring's hole is the core, placed as the ring is; every other ring's is the ring inside it.
        const ring = rings[finer ? Math.round((finer.z - cz) / m.spacing) * 2 + Math.round((finer.x - cx) / m.spacing) : 0];
        const { geometry } = m.mesh;
        if (geometry.index !== ring.index) geometry.setIndex(ring.index);
        const [first, last] = view ?? [0, SECTORS - 1];
        geometry.setDrawRange(ring.starts[first], ring.starts[last + 1] - ring.starts[first]);
        finer = { x: cx, z: cz };
      }
    },
    /** Whether every level has its window filled: the picture is complete. */
    get settled() { return queue.length === 0; },
    /** For the debug overlay: tiles waiting to go on the GPU, and the levels that hold a point (north, east) whole. */
    get queued() { return queue.length; },
    levelsAt(north, east) {
      const x = east, z = -north;
      return held.map((b, l) => (x > b.x && x < b.z && z > b.y && z < b.w ? l : -1)).filter((l) => l >= 0);
    },
  };
}

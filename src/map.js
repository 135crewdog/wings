// The map on the pause screen (the Ideas doc, picked 17 Nov 2026): the
// islands as the photographs the jet flies over, shrunk down, north up; a
// magenta dot on every airport; and the F-4C, green, where the jet is and
// pointing the way it heads. Made from the tiles already on the phone
// (src/hawaii.js), so nothing new downloads.
//
// A view is where the map's middle is and how many metres one pixel covers:
// { north, east, mpp }. Everything on the map is placed by toMap().

const LEVEL = 5;                      // the whole chain: 320 m a pixel, a few tiles
const ZOOM_LEVEL = 3;                 // zoomed in: 80 m a pixel
const ZOOM_ACROSS = 80000;            // metres across the map zoomed in: Oahu about fills it
const SEA = '#18466f';                // one blue for all the sea, near the coast and far out
const DOT = '#c81e96', DOT_EDGE = '#ffffff';
const DOT_SIZE = 9;                   // points across
const JET = '#7cff4f', JET_EDGE = 'rgba(0,0,0,0.75)';   // the HUD's green and outline
const JET_SIZE = 26;                  // points, nose to tail

/** The north and east the tiles of a pyramid level cover, in metres: the whole chain at the coarse levels. */
export function extent(index, level = LEVEL) {
  const span = index.tile * index.post * 2 ** level;
  const at = index.tiles.filter((t) => t[0] === level);
  const is = at.map((t) => t[1]), js = at.map((t) => t[2]);
  return {
    level, span,
    north0: Math.min(...is) * span, north1: (Math.max(...is) + 1) * span,
    east0: Math.min(...js) * span, east1: (Math.max(...js) + 1) * span,
  };
}

/** The view that shows all of an extent in a width × height map, middle on middle. */
export function wholeView(box, width, height) {
  return {
    north: (box.north0 + box.north1) / 2, east: (box.east0 + box.east1) / 2,
    mpp: Math.max((box.east1 - box.east0) / width, (box.north1 - box.north0) / height),
  };
}

/**
 * The view zoomed in round the jet: ZOOM_ACROSS metres across the map, the
 * jet in the middle unless that would show past the chain's edge, when the
 * view slides back inside it.
 */
export function zoomView(box, width, height, north, east) {
  const mpp = ZOOM_ACROSS / width;
  const inside = (at, low, high, half) => (high - low <= 2 * half ? (low + high) / 2 : Math.min(Math.max(at, low + half), high - half));
  return {
    north: inside(north, box.north0, box.north1, (height / 2) * mpp),
    east: inside(east, box.east0, box.east1, (width / 2) * mpp),
    mpp,
  };
}

/** The tiles of a level that cover what a view shows, as an extent on the tiles' own lines. */
export function cover(index, level, view, width, height) {
  const span = index.tile * index.post * 2 ** level;
  const halfN = (height / 2) * view.mpp, halfE = (width / 2) * view.mpp;
  return {
    level, span,
    north0: Math.floor((view.north - halfN) / span) * span, north1: Math.ceil((view.north + halfN) / span) * span,
    east0: Math.floor((view.east - halfE) / span) * span, east1: Math.ceil((view.east + halfE) / span) * span,
  };
}

/** Where a place (north, east, metres) falls on a width × height map: x right, y down. */
export function toMap(view, width, height, north, east) {
  return { x: width / 2 + (east - view.east) / view.mpp, y: height / 2 - (north - view.north) / view.mpp };
}

/** Each airport once, at the middle of its runways' ends: { airport, north, east }. */
export function airports(index) {
  const ends = new Map();
  for (const way of index.runways) {
    if (!ends.has(way.airport)) ends.set(way.airport, []);
    ends.get(way.airport).push(...way.ends);
  }
  return [...ends].map(([airport, e]) => ({
    airport,
    north: e.reduce((s, p) => s + p.north, 0) / e.length,
    east: e.reduce((s, p) => s + p.east, 0) / e.length,
  }));
}

/**
 * The way the nose points on the map for a true heading in degrees: a unit
 * { x, y }, x right and y down, so 0 is up the page and 90 to the right. The
 * silhouette, drawn nose up, is turned by the heading clockwise.
 */
export function noseOnMap(heading) {
  const a = (heading * Math.PI) / 180;
  return { x: Math.sin(a), y: -Math.cos(a) };
}

/**
 * The map for a canvas. `hawaii` is src/hawaii.js's; `silhouette()` a canvas
 * with the airplane seen from above, nose up, opaque where the airplane is
 * (or null until it's made). Returns { show(jet), prepare() }, jet { north,
 * east, heading }: show() draws the whole chain at once, and again when the
 * photographs are ready; prepare() starts on the chain's photographs ahead of
 * the first pause. A tap on the map zooms in round the jet; another, back out.
 */
export function createMap(canvas, hawaii, silhouette) {
  const { index } = hawaii;
  const chain = extent(index);
  const fields = airports(index);
  let whole = null, building = null, near = null, jet = null, zoomed = false, plane = null;
  const prepare = () => {
    building ??= build(chain).then((sheet) => { whole = sheet; draw(); }, () => { building = null; });   // a failure tries again at the next pause
    return building;
  };

  // The photographs of an extent, one tile at a time, with the sea painted one blue by the tiles' water flags.
  const build = async (box) => {
    const n = index.tile, cols = (box.east1 - box.east0) / box.span, rows = (box.north1 - box.north0) / box.span;
    const sheet = new OffscreenCanvas(cols * n, rows * n), ctx = sheet.getContext('2d');
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, sheet.width, sheet.height);
    const scratch = new OffscreenCanvas(n, n).getContext('2d', { willReadFrequently: true });
    const sea = [parseInt(SEA.slice(1, 3), 16), parseInt(SEA.slice(3, 5), 16), parseInt(SEA.slice(5, 7), 16)];
    for (let i = box.north0 / box.span; i < box.north1 / box.span; i++) {
      for (let j = box.east0 / box.span; j < box.east1 / box.span; j++) {
        const tile = await hawaii.pictures(box.level, i, j);
        if (!tile) continue;
        scratch.drawImage(tile.height, 0, 0);
        const water = scratch.getImageData(0, 0, n, n).data;
        scratch.drawImage(tile.colour, 0, 0);
        const image = scratch.getImageData(0, 0, n, n), px = image.data;
        for (let k = 0; k < n * n; k++) if (water[k * 4 + 2] > 127) px.set(sea, k * 4);
        tile.height.close(); tile.colour.close();
        ctx.putImageData(image, (j * box.span - box.east0) / box.span * n, (box.north1 - (i + 1) * box.span) / box.span * n);
      }
    }
    return sheet;
  };

  // The airplane, coloured once: the HUD's green with a dark edge so it reads on the photographs.
  const colour = (shape) => {
    const pad = Math.round(shape.height * 0.05), out = new OffscreenCanvas(shape.width + 2 * pad, shape.height + 2 * pad), ctx = out.getContext('2d');
    const tint = (fill) => {
      const c = new OffscreenCanvas(shape.width, shape.height), x = c.getContext('2d');
      x.drawImage(shape, 0, 0);
      x.globalCompositeOperation = 'source-in';
      x.fillStyle = fill;
      x.fillRect(0, 0, c.width, c.height);
      return c;
    };
    const edge = tint(JET_EDGE);
    for (let dx = -pad; dx <= pad; dx++) for (let dy = -pad; dy <= pad; dy++) if (dx * dx + dy * dy <= pad * pad) ctx.drawImage(edge, pad + dx, pad + dy);
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(tint(JET), pad, pad);
    return out;
  };

  const draw = () => {
    const ratio = window.devicePixelRatio || 1;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height || !jet) return;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, width, height);
    ctx.imageSmoothingQuality = 'high';
    const view = zoomed ? zoomView(chain, width, height, jet.north, jet.east) : wholeView(chain, width, height);
    const paint = (sheet, box) => {
      const a = toMap(view, width, height, box.north1, box.east0), b = toMap(view, width, height, box.north0, box.east1);
      ctx.drawImage(sheet, a.x, a.y, b.x - a.x, b.y - a.y);
    };

    // The whole chain's photographs always; zoomed in, the sharper ones over them once they're made.
    if (whole) paint(whole, chain); else prepare();
    if (zoomed) {
      const box = cover(index, ZOOM_LEVEL, view, width, height), key = JSON.stringify(box);
      if (near?.key !== key) {
        near = { key, box, sheet: null };
        const asked = near;
        build(box).then((sheet) => { asked.sheet = sheet; if (near === asked) draw(); }, () => { if (near === asked) near = null; });
      }
      if (near.sheet) paint(near.sheet, near.box);
    }

    for (const f of fields) {
      const p = toMap(view, width, height, f.north, f.east);
      ctx.beginPath();
      ctx.arc(p.x, p.y, DOT_SIZE / 2, 0, 2 * Math.PI);
      ctx.fillStyle = DOT; ctx.fill();
      ctx.lineWidth = 1; ctx.strokeStyle = DOT_EDGE; ctx.stroke();
    }

    const shape = silhouette();
    if (shape) {
      plane ??= colour(shape);
      const p = toMap(view, width, height, jet.north, jet.east);
      const scale = JET_SIZE / shape.height;
      const nose = noseOnMap(jet.heading);   // turned so the nose, up in the picture, points this way
      ctx.save();
      ctx.transform(-nose.y, nose.x, -nose.x, -nose.y, p.x, p.y);
      ctx.drawImage(plane, (-plane.width / 2) * scale, (-plane.height / 2) * scale, plane.width * scale, plane.height * scale);
      ctx.restore();
    }
  };

  canvas.addEventListener('click', () => { zoomed = !zoomed; draw(); });
  const show = (where) => { jet = where; zoomed = false; draw(); };
  return { show, prepare };
}

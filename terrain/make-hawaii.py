#!/usr/bin/env python3
"""Makes Hawaii for Wings: the tiles in terrain/hawaii/, from survey data.

docs/hawaii.md says what this builds; this file is how. It runs on a computer,
never on the phone, and needs Python 3 with numpy, rasterio and Pillow:

    pip install numpy rasterio pillow
    python3 terrain/make-hawaii.py [--cache DIR] [--only oahu]

It downloads (once, into --cache):
  - the ground: USGS 3D Elevation Program, 1/3 arc-second (about 10 m),
    public domain, in 1-degree tiles;
  - the pictures: ESA WorldCover 2021, a cloud-free year of Copernicus
    Sentinel-2 photographs at 10 m, CC BY 4.0, in 1-degree tiles;
  - where the water is: the WorldCover 2021 land-cover map, class 80;
  - the runways: OurAirports, public domain.

Each of five groups of islands is drawn in its own flat map about its middle,
so nothing on it is bent. The groups then slide along the chain toward Oahu
until every channel wider than 15 km is 15 km. The world's origin is the
threshold of runway 8R at Honolulu; north and east in metres.

The output is a pyramid of square tiles. Level 0 has a post every 10 m, 256
posts a side; each level up halves the detail and doubles the ground a tile
covers, to a top level of a few tiles holding everything. A post is the
middle of its 10 m square, so four posts make one post of the level above.
Only tiles with land in them are written: the rest is open sea. Each tile is two pictures:
  - heights: a PNG, red and green the height in steps of STEP metres above
    MIN (red the high byte), blue 255 where the post is water, else 0;
  - colour: a WebP of the satellite picture, one pixel per post.
The tiles are packed into sheets (a few MB each, SHEET tiles a side at each
level) listed in index.json with each tile's bytes, so the phone fetches tens
of files, not thousands, and a sheet that didn't change stays the same bytes.
"""

import argparse, csv, hashlib, io, json, math, os, sys, urllib.request
import numpy as np
import rasterio
from rasterio.merge import merge
from PIL import Image

ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, 'hawaii')

POST = 10.0          # m between level-0 posts
TILE = 256           # posts a tile side
SHEET = 8            # tiles a sheet side
MIN, STEP = -20.0, 0.25   # height encoding: MIN + (red * 256 + green) * STEP metres
CHANNEL = 15000.0    # m: every wider channel is cut to this
COAST = 2000.0       # m of sea round each group's box where tiles are looked for
HEIGHT_SCALE = 1.0   # the heights stretched by this: 1 is real (docs/hawaii.md)
WEBP_QUALITY = 82
MIN_RUNWAY_FT = 3000

# The five groups: a box round each (south, west, north, east, degrees) and
# which group it slides toward. Oahu stays put.
GROUPS = {
    'niihau':   {'box': (21.70, -160.30, 22.10, -159.95), 'toward': 'kauai'},
    'kauai':    {'box': (21.85, -159.82, 22.26, -159.26), 'toward': 'oahu'},
    'oahu':     {'box': (21.24, -158.30, 21.73, -157.63), 'toward': None},
    'mauinui':  {'box': (20.47, -157.35, 21.24, -155.96), 'toward': 'oahu'},
    'hawaii':   {'box': (18.89, -156.08, 20.28, -154.79), 'toward': 'mauinui'},
}
ORDER = ['oahu', 'kauai', 'niihau', 'mauinui', 'hawaii']   # each after the group it slides toward

USGS = 'https://prd-tnm.s3.amazonaws.com/StagedProducts/Elevation/13/TIFF/current/{t}/USGS_13_{t}.tif'
S2 = 'https://esa-worldcover-s2.s3.eu-central-1.amazonaws.com/rgbnir/2021/{lat}/ESA_WorldCover_10m_2021_v200_{t}_S2RGBNIR.tif'
MAP = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_{t}_Map.tif'
OURAIRPORTS = 'https://davidmegginson.github.io/ourairports-data/{f}.csv'


def log(*a):
    print(*a, file=sys.stderr, flush=True)


def fetch(url, path):
    """Downloads url to path once. A 404 is None: that tile is all sea."""
    if os.path.exists(path):
        return path
    log('  downloading', os.path.basename(path))
    req = urllib.request.Request(url, headers={'User-Agent': 'wings-terrain-script'})
    try:
        with urllib.request.urlopen(req, timeout=600) as r, open(path + '.part', 'wb') as f:
            while chunk := r.read(1 << 20):
                f.write(chunk)
    except urllib.error.HTTPError as e:
        if e.code in (403, 404):
            return None
        raise
    os.replace(path + '.part', path)
    return path


# ---- maps: each group flat about its own middle ----

def metres_per_degree(lat):
    """WGS 84: metres per degree of latitude and of longitude at a latitude."""
    p = math.radians(lat)
    m_lat = 111132.954 - 559.822 * math.cos(2 * p) + 1.175 * math.cos(4 * p)
    m_lon = 111412.84 * math.cos(p) - 93.5 * math.cos(3 * p) + 0.118 * math.cos(5 * p)
    return m_lat, m_lon


class Flat:
    """A flat map about (lat0, lon0): metres north and east."""
    def __init__(self, lat0, lon0):
        self.lat0, self.lon0 = lat0, lon0
        self.m_lat, self.m_lon = metres_per_degree(lat0)

    def to_ne(self, lat, lon):
        return (lat - self.lat0) * self.m_lat, (lon - self.lon0) * self.m_lon

    def to_latlon(self, n, e):
        return self.lat0 + n / self.m_lat, self.lon0 + e / self.m_lon


# ---- the sources, read for a box ----

def degree_tiles(box):
    s, w, n, e = box
    for lat in range(math.floor(s), math.ceil(n)):
        for lon in range(math.floor(w), math.ceil(e)):
            yield lat, lon


def read_mosaic(paths, box, bands=None, margin=0.01):
    """The sources' pixels over a box (plus a margin): (array, transform)."""
    s, w, n, e = box
    sets = [rasterio.open(p) for p in paths]
    try:
        data, transform = merge(sets, bounds=(w - margin, s - margin, e + margin, n + margin), indexes=[bands] if isinstance(bands, int) else bands)
    finally:
        for d in sets:
            d.close()
    return (data[0] if isinstance(bands, int) else data), transform


def sources_for(box, cache):
    dem, s2, lc = [], [], set()
    for lat, lon in degree_tiles(box):
        # USGS tiles are named by their north-west corner, WorldCover's by the south-west.
        t = f'n{lat + 1:02d}w{-lon:03d}'
        p = fetch(USGS.format(t=t), os.path.join(cache, f'USGS_13_{t}.tif'))
        if p: dem.append(p)
        t2 = f'N{lat:02d}W{-lon:03d}'
        p = fetch(S2.format(lat=f'N{lat:02d}', t=t2), os.path.join(cache, f'S2_{t2}.tif'))
        if p: s2.append(p)
        # The land-cover map comes in 3-degree tiles.
        lat3, lon3 = 3 * math.floor(lat / 3), 3 * math.floor(lon / 3)
        lc.add(f'N{lat3:02d}W{-lon3:03d}')
    maps = [p for t in sorted(lc) if (p := fetch(MAP.format(t=t), os.path.join(cache, f'MAP_{t}.tif')))]
    return dem, s2, maps


def sample(data, transform, lat, lon, nearest=False):
    """Bilinear (or nearest) samples of a raster at lat/lon arrays. Pixels are areas: their middles are at +0.5."""
    inv = ~transform
    col, row = inv * (lon, lat)
    col = col - 0.5
    row = row - 0.5
    h, w = data.shape[-2:]
    if nearest:
        r = np.clip(np.rint(row).astype(np.int64), 0, h - 1)
        c = np.clip(np.rint(col).astype(np.int64), 0, w - 1)
        return data[..., r, c]
    r0 = np.clip(np.floor(row).astype(np.int64), 0, h - 2)
    c0 = np.clip(np.floor(col).astype(np.int64), 0, w - 2)
    fr = np.clip(row - r0, 0, 1).astype(np.float32)
    fc = np.clip(col - c0, 0, 1).astype(np.float32)
    a = data[..., r0, c0].astype(np.float32); b = data[..., r0, c0 + 1].astype(np.float32)
    c = data[..., r0 + 1, c0].astype(np.float32); d = data[..., r0 + 1, c0 + 1].astype(np.float32)
    return (a * (1 - fc) + b * fc) * (1 - fr) + (c * (1 - fc) + d * fc) * fr


# ---- colour: the satellite's reflectance to a picture ----

def colour(refl):
    """Red, green and blue surface reflectance (x10000) to 8-bit colour: a
    gentle curve and a little more saturation, one rule for every island.
    Where the satellite has nothing (all zero, a few spots over water), the sea's colour."""
    empty = (refl <= 0).all(axis=0)
    x = np.clip(refl / 10000.0, 0, 1)
    x = np.clip((x - 0.005) * 3.6, 0, 1) ** (1 / 1.9)
    grey = x.mean(axis=0, keepdims=True)
    x = np.clip(grey + (x - grey) * 1.25, 0, 1)
    out = np.rint(x * 255).astype(np.uint8)
    out[:, empty] = np.array(SEA_RGB, np.uint8)[:, None]
    return out


# ---- one group at level 0, on the world's grid ----

def land_points(group, cache, step=0.002):
    """The group's coastline, every 200 m or so, as latitudes and longitudes: for the channel rule."""
    box = GROUPS[group]['box']
    dem, _, _ = sources_for(box, cache)
    data, tr = read_mosaic(dem, box, bands=1, margin=0)
    s, w, n, e = box
    lat, lon = np.meshgrid(np.arange(s, n, step), np.arange(w, e, step), indexing='ij')
    land = sample(data, tr, lat, lon, nearest=True) > 0.5
    sea = np.pad(~land, 1, constant_values=True)
    coast = land & (sea[:-2, 1:-1] | sea[2:, 1:-1] | sea[1:-1, :-2] | sea[1:-1, 2:])
    return lat[coast], lon[coast]


def slide_groups(cache):
    """Where each group's middle goes in the world: its real place in Oahu's
    flat map, slid toward its neighbour until the channel is CHANNEL wide."""
    world = Flat(21.4, -157.9)
    flats, points, centre = {}, {}, {}
    for g in ORDER:
        s, w, n, e = GROUPS[g]['box']
        flats[g] = Flat((s + n) / 2, (w + e) / 2)
        lat, lon = land_points(g, cache)
        points[g] = np.stack(world.to_ne(lat, lon), axis=1)
        centre[g] = np.array(world.to_ne(flats[g].lat0, flats[g].lon0))
    shift = {'oahu': np.zeros(2)}
    for g in ORDER[1:]:
        to = GROUPS[g]['toward']
        mine, theirs = points[g] + shift.get(to, 0), points[to] + shift[to]
        u = (centre[to] + shift[to]) - (centre[g] + shift[to])
        u = u / np.linalg.norm(u)

        def gap(t):
            a = mine + u * t
            best = np.inf
            for k in range(0, len(a), 2000):
                d = np.sqrt(((a[k:k + 2000, None, :] - theirs[None, :, :]) ** 2).sum(-1)).min()
                best = min(best, d)
            return best
        real = gap(0)
        t = 0.0
        if real > CHANNEL:
            lo, hi = 0.0, real
            for _ in range(40):
                mid = (lo + hi) / 2
                if gap(mid) > CHANNEL: lo = mid
                else: hi = mid
            t = lo
        shift[g] = shift[to] + u * t
        log(f'  {g}: channel to {to} {real / 1000:.1f} km real, {gap(t) / 1000:.1f} km in the game (slid {t / 1000:.1f} km)')
    # Each group's flat-map origin in the world, before the start's offset.
    return {g: centre[g] + shift[g] for g in ORDER}, flats


def runways(cache):
    airports = {r['ident']: r for r in csv.DictReader(open(fetch(OURAIRPORTS.format(f='airports'), os.path.join(cache, 'airports.csv'))))
                if r['iso_region'] == 'US-HI'}
    out = []
    for r in csv.DictReader(open(fetch(OURAIRPORTS.format(f='runways'), os.path.join(cache, 'runways.csv')))):
        a = airports.get(r['airport_ident'])
        if not a or r['closed'] == '1' or a['type'] == 'closed':
            continue
        if int(r['length_ft'] or 0) < MIN_RUNWAY_FT or not r['surface'].upper().startswith(('ASP', 'CON')):
            continue
        if not r['le_latitude_deg'] or not r['he_latitude_deg']:
            continue
        ends = [(float(r[f'{k}_latitude_deg']), float(r[f'{k}_longitude_deg'])) for k in ('le', 'he')]
        group = next((g for g, v in GROUPS.items() if all(v['box'][0] <= la <= v['box'][2] and v['box'][1] <= lo <= v['box'][3] for la, lo in ends)), None)
        if not group:
            continue
        out.append({'airport': a['ident'], 'name': a['name'], 'group': group, 'idents': [r['le_ident'], r['he_ident']],
                    'ends': ends, 'width': float(r['width_ft'] or 150) * 0.3048, 'length_ft': int(r['length_ft'])})
    return out


def build_group(g, flat, origin, cache, ways):
    """Level-0 tiles for one group: {(i, j): (heights m float32, water bool, rgb uint8)}."""
    box = GROUPS[g]['box']
    dem, s2, maps = sources_for(box, cache)
    log(f'  {g}: reading the sources')
    h_src, h_tr = read_mosaic(dem, box, bands=1)
    c_src, c_tr = read_mosaic(s2, box, bands=[1, 2, 3])
    w_src, w_tr = read_mosaic(maps, box, bands=1)
    s, w, n, e = box
    # The group's ground in the world, with the coastal sea round it.
    corners = [flat.to_ne(la, lo) for la in (s, n) for lo in (w, e)]
    n0 = min(c[0] for c in corners) + origin[0] - COAST; n1 = max(c[0] for c in corners) + origin[0] + COAST
    e0 = min(c[1] for c in corners) + origin[1] - COAST; e1 = max(c[1] for c in corners) + origin[1] + COAST
    span = TILE * POST
    tiles = {}
    group_ways = [r for r in ways if r['group'] == g]

    def natural(N, E):
        """The real ground at posts (north, east): heights, water, and whether in the group's box."""
        lat, lon = flat.to_latlon(N - origin[0], E - origin[1])
        inside = (lat >= s) & (lat <= n) & (lon >= w) & (lon <= e)
        h = sample(h_src, h_tr, lat, lon)
        cover = sample(w_src, w_tr, lat, lon, nearest=True)
        water = (cover == 80) | ((cover == 0) & (h <= 0.5)) | ~inside
        h = np.where(water & (h < 3), 0.0, h)   # the sea is at sea level
        return np.where(inside, h, 0.0), water, inside

    level_runways(group_ways, flat, origin, natural)
    for i in range(math.floor(n0 / span), math.floor(n1 / span) + 1):
        for j in range(math.floor(e0 / span), math.floor(e1 / span) + 1):
            # Posts in the middles of their squares, row 0 along the tile's north edge, with PAD more all round.
            north = (i + 1) * span - (np.arange(-PAD, TILE + PAD) + 0.5) * POST
            east = j * span + (np.arange(-PAD, TILE + PAD) + 0.5) * POST
            N, E = np.meshgrid(north, east, indexing='ij')
            h, water, inside = natural(N, E)
            core = (slice(PAD, PAD + TILE), slice(PAD, PAD + TILE))
            if not inside[core].any():
                continue
            if (water[core].all() and not near_runway(N[core], E[core], group_ways, flat, origin)):
                continue   # open sea: implied, never written
            h, water = flatten_runways(h, water, N, E, group_ways, flat, origin)
            h, water, N, E = h[core], water[core], N[core], E[core]
            lat, lon = flat.to_latlon(N - origin[0], E - origin[1])
            rgb = colour(sample(c_src, c_tr, lat, lon)).transpose(1, 2, 0)   # bands last: rows, columns, colour
            tiles[(i, j)] = (h.astype(np.float32) * HEIGHT_SCALE, water, rgb)
    log(f'  {g}: {len(tiles)} tiles at 10 m')
    return tiles


def near_runway(N, E, ways, flat, origin):
    """Whether any runway's end falls in this patch of posts (a runway on reclaimed land can be all 'water' in the map)."""
    for r in ways:
        for la, lo in r['ends']:
            n, e = np.array(flat.to_ne(la, lo)) + origin
            if N.min() - 500 <= n <= N.max() + 500 and E.min() - 500 <= e <= E.max() + 500:
                return True
    return False


BANK = 3.0     # a bank round a raised or dug-out runway: 3 m out for every 1 m up or down (the owner's 1 in 3, 17 Nov 2026)
PAD = 10       # posts of real ground worked round each tile, so the banks agree at the tiles' seams: 100 m, more than any bank needs
# m past the paint that is flat too. The picture draws the ground as triangles between points up to a
# square's diagonal from the paint, each point's height read from the posts round it, up to another
# diagonal away; so every post within two diagonals is flat, and the paint lies on flat ground to its edge.
FLAT = 2 * POST * math.sqrt(2)


def runway_frame(r, flat, origin):
    """A runway's first end in the world, its direction along and across, and its length."""
    (la1, lo1), (la2, lo2) = r['ends']
    a = np.array(flat.to_ne(la1, lo1)) + origin
    b = np.array(flat.to_ne(la2, lo2)) + origin
    L = float(np.linalg.norm(b - a))
    u = (b - a) / L
    return a, u, np.array([-u[1], u[0]]), L


def under(r, N, E, flat, origin):
    """The posts under a runway: its paint and FLAT past its edges and ends."""
    a, u, v, L = runway_frame(r, flat, origin)
    along = (N - a[0]) * u[0] + (E - a[1]) * u[1]
    across = (N - a[0]) * v[0] + (E - a[1]) * v[1]
    return (along >= -FLAT) & (along <= L + FLAT) & (np.abs(across) <= r['width'] / 2 + FLAT)


def spread(change, keep):
    """The most a change made at the `keep` posts can be anywhere, falling by
    1 m for every BANK m from them (minus infinity where none reaches)."""
    out = np.where(keep, change, -np.inf)
    steps = [((dr, dc), POST * math.hypot(dr, dc) / BANK) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if dr or dc]
    while True:
        before = out
        for (dr, dc), lose in steps:
            moved = np.full_like(out, -np.inf)
            rs = slice(max(dr, 0), out.shape[0] + min(dr, 0)); rd = slice(max(-dr, 0), out.shape[0] + min(-dr, 0))
            cs = slice(max(dc, 0), out.shape[1] + min(dc, 0)); cd = slice(max(-dc, 0), out.shape[1] + min(-dc, 0))
            moved[rs, cs] = out[rd, cd] - lose
            out = np.maximum(out, moved)
        if np.array_equal(out, before):
            return out


def flatten_runways(h, water, N, E, ways, flat, origin):
    """Each runway dead flat at its height (level_runways) on the posts under
    it, and round it a bank down or up to the real ground, which is left as it
    is beyond: the change fades by 1 m for every BANK m, so the bank adds no
    more than 1 in BANK to the ground's own slope (the owner's choice, 17 Nov
    2026: where the real ground falls away, the two add up, and nothing natural is reshaped). `h`, `water`, `N` and `E` are a
    tile's posts with PAD more round it; the tile is cut out of them after.
    Under a runway, and wherever a bank raises the ground, is dry land."""
    target = np.full(h.shape, np.nan)
    for r in ways:
        mine = under(r, N, E, flat, origin)
        if mine.any():
            target[mine] = r['height']
    flatten = ~np.isnan(target)
    if not flatten.any():
        return h, water
    # The change under the runways, carried out round them: between the most and
    # the least it can be with no bank steeper than 1 in BANK, the one nearest no
    # change at all. So raised ground slopes down to the real ground, dug ground
    # up to it, and beyond the banks the ground is untouched.
    change = np.where(flatten, target - h, 0.0)
    least = spread(change, flatten)
    most = -spread(-change, flatten)
    made = np.maximum(least, np.minimum(0.0, most))
    out = np.where(flatten, target, h + made)
    # The check: outside the runways, the levelling's change never climbs or falls faster than 1 in BANK.
    # (The ground's own slope adds to it: a bank beside a gully is steeper than the bank alone.)
    made = np.where(flatten, np.nan, made)
    for axis in (0, 1):
        slope = np.abs(np.diff(made, axis=axis)) / POST
        if np.nanmax(slope, initial=0) > 1 / BANK + 1e-6:
            raise SystemExit(f'a runway bank is steeper than 1 in {BANK:.0f}: 1 in {1 / np.nanmax(slope):.2f}')
    dry = flatten | ((made > 0) & (out > 0.5))
    return out, water & ~dry


def level_runways(ways, flat, origin, natural):
    """Each runway's height: dead flat (the owner's choice, 17 Nov 2026), at
    the middle value of the real ground under it, which moves the least ground,
    set to a height the tiles hold exactly (MIN + k·STEP) so it is saved with
    no steps. Runways that cross or touch share one height, so they meet."""
    group = {id(r): {id(r)} for r in ways}
    for i, r in enumerate(ways):
        for q in ways[i + 1:]:
            if r['airport'] == q['airport'] and touching(r, q, flat, origin):
                joined = group[id(r)] | group[id(q)]
                for k in joined:
                    group[k] = joined
    done = set()
    for r in ways:
        if id(r) in done:
            continue
        mine = [q for q in ways if id(q) in group[id(r)]]
        ground = []
        for q in mine:
            a, u, v, L = runway_frame(q, flat, origin)
            t, k = np.meshgrid(np.arange(-FLAT, L + FLAT, POST / 2), np.arange(-q['width'] / 2 - FLAT, q['width'] / 2 + FLAT, POST / 2), indexing='ij')
            ground.append(natural(a[0] + u[0] * t + v[0] * k, a[1] + u[1] * t + v[1] * k)[0].ravel())
        ground = np.concatenate(ground)
        best = max(float(np.median(ground)), 0.5)   # never at or below the sea
        height = (MIN + round((best * HEIGHT_SCALE - MIN) / STEP) * STEP) / HEIGHT_SCALE
        most = float(np.abs(ground - height).max())
        if most * BANK > PAD * POST:
            raise SystemExit(f'{r["airport"]}: a bank {most * BANK:.0f} m wide reaches past the {PAD * POST:.0f} m worked round a tile: make PAD bigger')
        names = ', '.join('/'.join(q['idents']) for q in mine)
        log(f'    {r["airport"]} {names}: {height:.2f} m ({height / 0.3048:.0f} ft); the real ground under it from'
            f' {ground.min() - height:+.1f} to {ground.max() - height:+.1f} m; banks reach up to {most * BANK:.0f} m')
        for q in mine:
            q['height'] = height
            done.add(id(q))


def touching(r, q, flat, origin):
    """Whether two runways' paint crosses or touches."""
    def corners(x):
        a, u, v, L = runway_frame(x, flat, origin)
        w = x['width'] / 2
        return [a + u * t + v * k for t in (0, L) for k in (-w, w)], (u, v)
    cr, axr = corners(r)
    cq, axq = corners(q)
    for axis in (*axr, *axq):   # two rectangles are apart if some side's direction separates them
        pr = [float(p @ axis) for p in cr]; pq = [float(p @ axis) for p in cq]
        if max(pr) < min(pq) or max(pq) < min(pr):
            return False
    return True


# ---- the pyramid, and writing it ----

def coarser(tiles):
    """The level above: each tile from its four children, open sea where a child is missing."""
    parents = {}
    for (i, j) in tiles:
        parents.setdefault((i // 2, j // 2), []).append((i, j))
    out = {}
    half = TILE // 2
    for (pi, pj), kids in parents.items():
        h = np.zeros((TILE, TILE), np.float32)
        wt = np.ones((TILE, TILE), bool)
        rgb = np.zeros((TILE, TILE, 3), np.uint8)
        rgb[:] = SEA_RGB
        for (i, j) in kids:
            ch, cw, cr = tiles[(i, j)]
            # Row 0 is the north edge: the northern child (odd i) fills the top half.
            r0 = 0 if i % 2 == 1 else half
            c0 = 0 if j % 2 == 0 else half
            h[r0:r0 + half, c0:c0 + half] = ch.reshape(half, 2, half, 2).mean(axis=(1, 3))
            wt[r0:r0 + half, c0:c0 + half] = cw.reshape(half, 2, half, 2).sum(axis=(1, 3)) >= 2
            rgb[r0:r0 + half, c0:c0 + half] = cr.reshape(half, 2, half, 2, 3).mean(axis=(1, 3)).round().astype(np.uint8)
        out[(pi, pj)] = (h, wt, rgb)
    return out


SEA_RGB = (16, 40, 70)


def encode(tile):
    h, wt, rgb = tile
    q = np.clip(np.rint((h - MIN) / STEP), 0, 65535).astype(np.uint16)
    px = np.stack([(q >> 8).astype(np.uint8), (q & 255).astype(np.uint8), np.where(wt, 255, 0).astype(np.uint8)], axis=-1)
    hb = io.BytesIO(); Image.fromarray(px, 'RGB').save(hb, 'PNG', optimize=True)
    cb = io.BytesIO(); Image.fromarray(rgb, 'RGB').save(cb, 'WEBP', quality=WEBP_QUALITY, method=6)
    return hb.getvalue(), cb.getvalue()


def write(levels, ways, start, groups_info):
    os.makedirs(OUT, exist_ok=True)
    index = {'post': POST, 'tile': TILE, 'min': MIN, 'step': STEP, 'heightScale': HEIGHT_SCALE,
             'levels': len(levels), 'sheets': {}, 'tiles': [], 'runways': [], 'start': start, 'groups': groups_info,
             'credits': ['Elevation: U.S. Geological Survey, 3D Elevation Program (public domain).',
                         'Imagery: ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC BY 4.0).',
                         'Runways: OurAirports (public domain).']}
    written = set()
    total = 0
    for lv, tiles in enumerate(levels):
        sheets = {}
        for (i, j) in sorted(tiles):
            sheets.setdefault((i // SHEET, j // SHEET), []).append((i, j))
        for (si, sj), keys in sorted(sheets.items()):
            name = f'{lv}/{si}_{sj}.bin'
            blob = bytearray()
            for (i, j) in keys:
                hb, cb = encode(tiles[(i, j)])
                index['tiles'].append([lv, i, j, name, len(blob), len(hb), len(blob) + len(hb), len(cb)])
                blob += hb + cb
            path = os.path.join(OUT, name)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            with open(path, 'wb') as f:
                f.write(blob)
            index['sheets'][name] = {'bytes': len(blob), 'sha256': hashlib.sha256(blob).hexdigest()[:16]}
            written.add(name)
            total += len(blob)
        log(f'  level {lv}: {len(tiles)} tiles, {len(sheets)} sheets')
    index['bytes'] = total
    index['runways'] = ways
    # Sheets from an earlier run that this one didn't write go.
    for dirpath, _, files in os.walk(OUT):
        for f in files:
            rel = os.path.relpath(os.path.join(dirpath, f), OUT).replace(os.sep, '/')
            if rel.endswith('.bin') and rel not in written:
                os.remove(os.path.join(dirpath, f))
    with open(os.path.join(OUT, 'index.json'), 'w') as f:
        json.dump(index, f, separators=(',', ':'))
    log(f'  {total / 1e6:.1f} MB in all')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--cache', default=os.path.join(ROOT, '.cache'))
    ap.add_argument('--only', nargs='*', help='make only these groups (to try a change on one island)')
    args = ap.parse_args()
    os.makedirs(args.cache, exist_ok=True)
    log('Sliding the islands together')
    saved = os.path.join(args.cache, f'slide-{CHANNEL:.0f}.json')
    if os.path.exists(saved):
        centres = {g: np.array(v) for g, v in json.load(open(saved)).items()}
        flats = {g: Flat((GROUPS[g]['box'][0] + GROUPS[g]['box'][2]) / 2, (GROUPS[g]['box'][1] + GROUPS[g]['box'][3]) / 2) for g in ORDER}
    else:
        centres, flats = slide_groups(args.cache)
        json.dump({g: list(map(float, v)) for g, v in centres.items()}, open(saved, 'w'))
    ways = runways(args.cache)
    # The world's origin: the threshold of runway 8R at Honolulu.
    r8 = next(r for r in ways if r['airport'] == 'PHNL' and r['idents'][0] == '08R')
    o = np.array(flats['oahu'].to_ne(*r8['ends'][0])) + centres['oahu']
    origins = {g: centres[g] - o for g in ORDER}
    level0 = {}
    for g in (args.only or ORDER):
        log(f'Making {g}')
        level0.update(build_group(g, flats[g], origins[g], args.cache, ways))
    levels = [level0]
    while len(levels[-1]) > 4:
        levels.append(coarser(levels[-1]))
    made = set(args.only or ORDER)
    out_ways = []
    for r in ways:
        if r['group'] not in made or 'height' not in r:
            continue
        height = round(r['height'] * HEIGHT_SCALE, 2)
        ends = []
        for (la, lo), ident in zip(r['ends'], r['idents']):
            n, e = np.array(flats[r['group']].to_ne(la, lo)) + origins[r['group']]
            ends.append({'ident': ident, 'north': round(float(n), 2), 'east': round(float(e), 2), 'height': height})
        # The runway's surface, height = a + b·north + c·east in the world, for drawing it: dead flat, so b and c are 0.
        out_ways.append({'airport': r['airport'], 'name': r['name'], 'width': round(r['width'], 1), 'ends': ends, 'surface': [height, 0, 0]})
    # The start is 8R at Honolulu; a trial build of other islands alone has none.
    start = next((w for w in out_ways if w['airport'] == 'PHNL' and w['ends'][0]['ident'] == '08R'), None)
    groups_info = {g: {'origin': [round(float(x), 1) for x in origins[g]], 'lat0': flats[g].lat0, 'lon0': flats[g].lon0} for g in ORDER}
    write(levels, out_ways, {'airport': 'PHNL', 'runway': '08R', **start['ends'][0]} if start else None, groups_info)


if __name__ == '__main__':
    main()

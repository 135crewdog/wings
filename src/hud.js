// The head-up display: thin green symbols over the view, the way a fighter
// HUD looks. From 135crewdog/rage, src/hud/hud.js, without the F-16's
// steerpoint and bullseye: Wings has no navigation. Drawn on a 2-D canvas
// every frame in flight; switched on and off on the pause screen. Ignores
// the theme: a real HUD is green whatever the light.
//
// The HUD is conformal with the view: the flight-path marker, the waterline
// and the pitch ladder are world directions projected through the chase
// camera, so the marker sits on the point the airplane is flying toward and
// the ladder rolls and scales with the camera. Straight up and straight down
// get the zenith and nadir symbols when the ladder's window reaches them.
// The bank scale over the waterline is 135crewdog/warwagon's (src/hud/hud.js),
// drawn the Boeing way, and so is the VSI over the altitude. Airspeed and altitude are written by
// src/readouts.js's rules, mirrored about the middle, and with the HUD
// switched off they are all that is drawn.

const GREEN = '#7cff4f';
const OUTLINE = 'rgba(0,0,0,0.75)';
const D2R = Math.PI / 180;
const LADDER_RANGE = 12.5;   // deg of pitch each side of the nose that the ladder shows
const BAR_HALF = 64;         // px, half-length of a pitch bar; the bars are symbols, so they never shrink
const BAR_GAP = 22;          // px, half the gap in the middle of a bar
const NUMBER_GAP = 42;       // px, from the HUD's edge to the inner edge of the airspeed or altitude
const HORIZON_SHORT = 14;    // px, how far short of the airspeed and altitude the horizon line stops
export const BANK_TICKS = [-90, -60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60, 90];   // deg, the bank scale's ticks: War Wagon's, and 60 and 90
/** Whether a bank tick is a long one: all but 10 and 20. */
export const longBankTick = (deg) => Math.abs(deg) !== 10 && Math.abs(deg) !== 20;

// A unit north, east, down direction at heading ψ and pitch θ (degrees).
function direction(headingDeg, pitchDeg) {
  const h = headingDeg * D2R, p = pitchDeg * D2R;
  return [Math.cos(p) * Math.cos(h), Math.cos(p) * Math.sin(h), -Math.sin(p)];
}

// The direction a little to the right of (ψ, θ): used to find which way a
// pitch bar lies on the screen, whatever the camera's bank.
function rightOf(headingDeg, pitchDeg) {
  const d = direction(headingDeg, pitchDeg);
  const h = headingDeg * D2R;
  const e = 0.03;
  const v = [d[0] - e * Math.sin(h), d[1] + e * Math.cos(h), d[2]];
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[1] / m, v[2] / m];
}

/** A heading in degrees, any value, as the HUD writes it: "000" to "359". */
export function headingText(deg) {
  return String(((Math.round(deg) % 360) + 360) % 360).padStart(3, '0');
}

// Hawaii's magnetic variation, degrees east (the HNL VORTAC's, OurAirports;
// docs/hawaii.md). The heading tape reads magnetic, as the charts and the
// runway numbers do: on 8R at Honolulu it reads 080. The ladder and every
// symbol drawn in the view stay true, since they are directions in the world.
export const VARIATION = 9.6;

/** A true heading (degrees) as a magnetic one, 0..360. */
export function magnetic(trueDeg) {
  return (((trueDeg - VARIATION) % 360) + 360) % 360;
}

/**
 * Where a heading falls across the screen, px from the middle: `offset`
 * degrees right of the heading the view looks along, for a view whose
 * focal length is `focal` px (see focalLength). That is where the heading
 * lies on the horizon, so the tape lines up with the world. Null for a
 * heading beside or behind the view.
 */
export function tapeX(offset, focal) {
  const d = ((((offset + 180) % 360) + 360) % 360) - 180;
  return Math.abs(d) < 90 ? focal * Math.tan(d * D2R) : null;
}

/**
 * How far right of the jet's heading the swung view looks, in degrees of
 * heading. The view swings about the jet's own axes (src/render/camera.js:
 * `yaw` about its up, positive left, then `look` pitch about its wings,
 * positive up), so with the wings level a swing of 15 degrees right is 15
 * degrees of heading, but in a 60-degree bank it is under 8 and the view
 * tilts down; in a 90-degree bank it is none. `pitch` and `roll` are the
 * jet's (degrees).
 */
export function viewHeading(pitch, roll, yaw, look = 0) {
  const t = pitch * D2R, f = roll * D2R, y = yaw * D2R, p = look * D2R;
  const x = Math.cos(p) * Math.cos(y), r = -Math.cos(p) * Math.sin(y), d = -Math.sin(p);   // the view's direction: forward, right, down
  const right = r * Math.cos(f) - d * Math.sin(f), down = r * Math.sin(f) + d * Math.cos(f);  // the jet's bank, then its pitch
  const north = x * Math.cos(t) + down * Math.sin(t);
  return Math.abs(north) + Math.abs(right) < 1e-9 ? 0 : Math.atan2(right, north) / D2R;
}

/** A camera's focal length in px, from its vertical field of view (degrees) and the view's height (px). */
export function focalLength(fovDeg, height) {
  return height / 2 / Math.tan((fovDeg / 2) * D2R);
}

/**
 * The heading tape's marks, after 135crewdog/warwagon's: a tick every 5
 * degrees and a two-digit number every 10, sliding past under the readout,
 * which sits in the tape's own row under the pointer. The tape follows the
 * view: `centre` is the magnetic heading the view looks along, `focal` its
 * focal length (px) and `reach` how far out from the middle the tape runs
 * (px). `pointer` is where the pointer is, px from the middle, or null when
 * it is off the tape: a tick right under it, or a number that would sit
 * under the readout, is left out. Returns [{ x, major, label }], x from the
 * middle.
 */
export function tapeMarks(centre, focal, reach, pointer = 0) {
  const marks = [];
  const span = Math.atan(reach / focal) / D2R;   // degrees each side of the middle that the tape shows
  for (let deg = Math.ceil((centre - span) / 5) * 5; deg <= centre + span; deg += 5) {
    const x = tapeX(deg - centre, focal);
    if (x === null || Math.abs(x) > reach) continue;
    const near = pointer === null ? Infinity : Math.abs(x - pointer);
    if (near < 8) continue;   // clear of the pointer
    const major = deg % 10 === 0;
    const label = major && near > 30 ? String((((deg % 360) + 360) % 360) / 10).padStart(2, '0') : null;   // under the readout otherwise
    marks.push({ x, major, label });
  }
  return marks;
}

// Which way the tadpole's tail points: toward the station's place on the
// screen when it is in front of the camera, else straight left or right by
// the relative bearing (degrees, -180..180). A unit screen vector. (Rage's.)
export function cueDirection(screen, from, relativeBearingDeg) {
  if (screen && screen.visible) {
    const dx = screen.x - from.x, dy = screen.y - from.y, m = Math.hypot(dx, dy);
    if (m > 1) return { x: dx / m, y: dy / m };
  }
  return { x: relativeBearingDeg < 0 ? -1 : 1, y: 0 };
}

/** A bearing relative to a heading, -180..180, negative to the left. (Rage's.) */
export function relativeBearing(headingDeg, bearingDeg) {
  let r = (bearingDeg - headingDeg) % 360;
  if (r > 180) r -= 360; else if (r < -180) r += 360;
  return r;
}

/** The steerpoint's line, lower right: range in nautical miles, then its name: "12.4 > HNL". */
export function steerText(rangeNm, name) {
  return `${rangeNm.toFixed(1)} > ${name}`;
}

/**
 * The VSI, as War Wagon writes it (135crewdog/warwagon, src/hud/hud.js,
 * vsiText): the climb rate in feet per minute to the nearest 50, unlabelled,
 * "+750" climbing, "−1200" with a true minus sign descending, and "0" within
 * 25 of level. Rounded on its size, so climbing and descending read alike.
 */
export function vsiText(fpm) {
  const v = Math.round(Math.abs(fpm) / 50) * 50;
  if (v === 0) return '0';
  return (fpm > 0 ? '+' : '−') + v;
}

/**
 * The engine's power, as the HUD writes it: IDLE, a percentage of MIL in dry
 * power, MIL, or AB with how much of the afterburner is lit. `power` is the
 * engine's own state (0 idle, 1 MIL, 2 full afterburner), not the throttle's
 * position, so the spool-up shows.
 */
export function powerText(power) {
  if (power > 1.005) return `AB ${Math.round((power - 1) * 100)}%`;
  if (power >= 0.995) return 'MIL';
  if (power < 0.005) return 'IDLE';
  return `${Math.round(power * 100)}%`;
}

/**
 * Where the airspeed and altitude sit, mirrored about the middle `cx`: as far
 * out as the HUD's edges let both go, `left` clear of the throttle and
 * `right` clear of the buttons (on a landscape iPhone the buttons decide).
 * Returns { out, airspeed, altitude, horizon }: how far each number's inner
 * edge is from the middle, the airspeed's right edge, the altitude's left
 * edge, and the half-length of the horizon line, which stops a little short
 * of both.
 */
export function numberPlaces(cx, left, right) {
  const out = Math.min(right - NUMBER_GAP - cx, cx - left - NUMBER_GAP);
  return { out, airspeed: cx - out, altitude: cx + out, horizon: out - HORIZON_SHORT };
}

/**
 * The bank scale, as War Wagon's (and Boeing's displays) draw it: the arc of
 * ticks belongs to the horizon and turns with it, and the pointer belongs to
 * the jet, so in a right bank the arc turns anticlockwise and the pointer
 * stands over the right-hand ticks: the bank is read on the banked side.
 * A tick's angle on the glass, from straight up, positive clockwise, for the
 * horizon's own angle on the glass (0 level, negative in a right bank).
 */
export function bankTickAngle(tickDeg, horizonDeg) {
  return tickDeg + horizonDeg || 0;
}

/**
 * Which of the two apex symbols the ladder's window has reached, if either:
 * the zenith when straight up is within LADDER_RANGE of the nose, the nadir
 * when straight down is.
 */
export function apexFor(pitchDeg) {
  if (pitchDeg >= 90 - LADDER_RANGE) return 'zenith';
  if (pitchDeg <= -90 + LADDER_RANGE) return 'nadir';
  return null;
}

/**
 * Returns { draw(reading, project, view, full), clear() } for a canvas over the
 * whole view. `safe()` returns the safe area's rectangle in CSS pixels; the
 * numbers stay inside it.
 */
export function createHud(canvas, safe) {
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, dpr = 1;

  // Sized every frame it is drawn: iOS can report a new size late after a rotation.
  function fit() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth; h = canvas.clientHeight;
    const width = Math.round(w * dpr), height = Math.round(h * dpr);
    if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  }

  // Every stroke and glyph is drawn twice: a dark outline, then the green.
  function stroke(draw) {
    ctx.lineWidth = 3.5; ctx.strokeStyle = OUTLINE; ctx.beginPath(); draw(); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = GREEN; ctx.beginPath(); draw(); ctx.stroke();
  }
  function text(s, x, y, align = 'left', size = 15) {
    ctx.font = `${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineWidth = 3; ctx.strokeStyle = OUTLINE; ctx.lineJoin = 'round'; ctx.strokeText(s, x, y);
    ctx.fillStyle = GREEN; ctx.fillText(s, x, y);
  }
  function dashed(on) { ctx.setLineDash(on ? [8, 6] : []); }

  // The zenith symbol: an eight-pointed star with the lowest point drawn
  // long as a tail toward the bottom of the display.
  function zenith(x, y, r) {
    stroke(() => {
      for (let k = 0; k <= 16; k++) {
        const a = -Math.PI / 2 + (Math.PI * 2 * (k % 16)) / 16;
        const rr = k % 2 ? r * 0.6 : k % 16 === 8 ? r * 2 : r * 1.25;
        const px = x + rr * Math.cos(a), py = y + rr * Math.sin(a);
        if (k === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
    });
  }
  // The nadir symbol: a circle hatched with horizontal lines, a short tail up.
  function nadir(x, y, r) {
    stroke(() => {
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, Math.PI * 2);
      for (const f of [-0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75]) {
        const half = r * Math.sqrt(1 - f * f);
        ctx.moveTo(x - half, y + f * r); ctx.lineTo(x + half, y + f * r);
      }
      ctx.moveTo(x, y - r); ctx.lineTo(x, y - r * 2);
    });
  }

  /**
   * reading: { airspeed, altitude (text), heading, pitch, roll (deg), g,
   * alpha (deg), mach, vsi (ft/min), power (0..2), velocity, nose, up (unit north, east,
   * down), and
   * steer, the steerpoint: { dir (unit north, east, down to it), bearing
   * (deg true), range (nm), name } };
   * project: a north, east, down direction → { x, y, visible } on the
   * screen; view: { looking, true while the view is swung away from the
   * chase position; yaw and pitch, how far it is swung (degrees, positive
   * left and up, about the jet's own axes);
   * focal, the camera's focal length (px) }; full: false draws only the
   * airspeed and altitude, for the HUD switched off.
   */
  function draw(reading, project, view = {}, full = true) {
    const { looking = false, yaw = 0, pitch = 0, focal = focalLength(55, canvas.clientHeight) } = view;
    fit();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const area = safe();
    const cx = w / 2, cy = h / 2;
    // Clear of the throttle on the left and the buttons on the right.
    const left = area.left + 84, right = area.right - 170, top = area.top + 8, bottom = area.bottom - 14;

    // airspeed on the left, altitude on the right, the same distance from
    // the middle: all that shows with the HUD switched off
    const at = numberPlaces(cx, left, right);
    const numbers = () => {
      text(reading.airspeed, at.airspeed, cy, 'right', 20);
      text(reading.altitude, at.altitude, cy, 'left', 20);
    };
    if (!full) { numbers(); return; }

    // heading tape across the top, magnetic, as War Wagon's: the pointer at
    // the top, the readout in the tape's own row under it, and the tape's
    // numbers passing beneath as the jet turns, which keeps the top short.
    // The tape follows the view: it shows the headings the view looks
    // across, each over its own direction on the horizon. The pointer and
    // readout stay with the nose, over the jet's heading, so with the view
    // swung they move across the screen like the waterline and slide off
    // the tape's end with the nose. Not swung, the pointer is in the middle.
    const hdg = reading.heading, mag = magnetic(hdg);
    const reach = w * 0.22, edge = reach + 12;   // the tape's half-width, and where its window ends
    const swing = viewHeading(reading.pitch, reading.roll, yaw, pitch);   // where the view looks, degrees right of the nose
    const px = tapeX(-swing, focal), pointer = px !== null && Math.abs(px) < edge + 20 ? px : null;
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - edge, top, 2 * edge, 34); ctx.clip();
    if (pointer !== null) {
      const x = cx + pointer;
      stroke(() => { ctx.moveTo(x, top + 13); ctx.lineTo(x - 5, top + 4); ctx.lineTo(x + 5, top + 4); ctx.closePath(); });
      text(headingText(mag), x, top + 24, 'center', 15);
    }
    for (const m of tapeMarks(mag + swing, focal, reach, pointer)) {
      stroke(() => { ctx.moveTo(cx + m.x, top + 4); ctx.lineTo(cx + m.x, top + (m.major ? 14 : 9)); });
      if (m.label) text(m.label, cx + m.x, top + 23, 'center', 12);
    }
    ctx.restore();

    // pitch ladder: each bar is a fixed-size symbol drawn where its pitch
    // angle falls on the screen, lying along the horizon's direction there.
    // Only the bars within LADDER_RANGE of the nose show, plus the horizon
    // line itself, the way a real HUD's glass shows a window of the ladder.
    ctx.save();
    ctx.beginPath(); ctx.rect(cx - w * 0.3, top + 36, w * 0.6, bottom - top - 96); ctx.clip();
    const pFirst = Math.ceil((reading.pitch - LADDER_RANGE) / 5) * 5, pLast = Math.floor((reading.pitch + LADDER_RANGE) / 5) * 5;
    const bars = [];
    for (let p = pFirst; p <= pLast; p += 5) if (p >= -85 && p <= 85) bars.push(p);
    if (!bars.includes(0)) bars.push(0);
    for (const p of bars) {
      const c = project(direction(hdg, p));
      if (!c.visible) continue;
      const r = project(rightOf(hdg, p));
      let ux = r.x - c.x, uy = r.y - c.y;
      const len = Math.hypot(ux, uy) || 1;
      ux /= len; uy /= len;                           // along the bar, to the right
      const nx = uy, ny = -ux;                        // screen "up" in the bar's frame
      const half = p === 0 ? at.horizon : BAR_HALF, gap = p === 0 ? 40 : BAR_GAP;
      const tick = p > 0 ? -8 : 8;                    // end ticks point toward the horizon
      dashed(p < 0);
      stroke(() => {
        ctx.moveTo(c.x - ux * half, c.y - uy * half); ctx.lineTo(c.x - ux * gap, c.y - uy * gap);
        ctx.moveTo(c.x + ux * gap, c.y + uy * gap); ctx.lineTo(c.x + ux * half, c.y + uy * half);
        if (p !== 0) {
          ctx.moveTo(c.x - ux * half, c.y - uy * half); ctx.lineTo(c.x - ux * half + nx * tick, c.y - uy * half + ny * tick);
          ctx.moveTo(c.x + ux * half, c.y + uy * half); ctx.lineTo(c.x + ux * half + nx * tick, c.y + uy * half + ny * tick);
        }
      });
      dashed(false);
      if (p !== 0) {
        text(String(Math.abs(p)), c.x - ux * (half + 14), c.y - uy * (half + 14), 'center', 12);
        text(String(Math.abs(p)), c.x + ux * (half + 14), c.y + uy * (half + 14), 'center', 12);
      }
    }
    // straight up and straight down, once the ladder's window reaches them:
    // conformal like the bars, but upright on the screen rather than rolling
    const apex = apexFor(reading.pitch);
    if (apex) {
      const c = project(apex === 'zenith' ? [0, 0, -1] : [0, 0, 1]);
      if (c.visible) (apex === 'zenith' ? zenith : nadir)(c.x, c.y, 16);
    }
    ctx.restore();

    // waterline: where the nose points
    const n = project(reading.nose);
    if (n.visible) {
      const nx = n.x, ny = n.y;
      stroke(() => {
        ctx.moveTo(nx - 22, ny); ctx.lineTo(nx - 10, ny); ctx.lineTo(nx - 5, ny + 7); ctx.lineTo(nx, ny); ctx.lineTo(nx + 5, ny + 7); ctx.lineTo(nx + 10, ny); ctx.lineTo(nx + 22, ny);
      });
    }

    // bank scale, from War Wagon: conformal, like the ladder. The arc of
    // ticks is centred on the waterline, so it stays in front of the jet
    // whatever the view, and turns with the horizon (from the same
    // projection as the pitch ladder; from the bank alone when the horizon
    // can't be projected), long at 0, 30, 45, 60 and 90 and unnumbered, as
    // on the attitude indicator; the pointer, the heading pointer's
    // triangle, belongs to the jet, so it points along the jet's own up as
    // the view sees it. Drawn only while the nose is in view. The radius
    // brings the long ticks to 8 px under the heading readout in the plain
    // chase view, where the waterline sits 9 px above the middle.
    if (n.visible) {
      const bx = n.x, by = n.y, br = Math.min(140, cy - top - 60);
      let horizonDeg = -reading.roll, jetDeg = 0;
      const hc = project(direction(hdg, reading.pitch)), hr = project(rightOf(hdg, reading.pitch));
      if (hc.visible && hr.visible) horizonDeg = Math.atan2(hr.y - hc.y, hr.x - hc.x) / D2R;
      const nose = reading.nose, up = reading.up;
      const u = project([nose[0] + 0.05 * up[0], nose[1] + 0.05 * up[1], nose[2] + 0.05 * up[2]]);   // a little above the nose, the jet's way up
      if (u.visible) jetDeg = Math.atan2(u.x - n.x, -(u.y - n.y)) / D2R;                           // clockwise from screen-up
      for (const t of BANK_TICKS) {
        const a = (bankTickAngle(t, horizonDeg) - 90) * D2R;   // from straight up, positive clockwise
        const r0 = br, r1 = br + (longBankTick(t) ? 12 : 6);
        stroke(() => { ctx.moveTo(bx + r0 * Math.cos(a), by + r0 * Math.sin(a)); ctx.lineTo(bx + r1 * Math.cos(a), by + r1 * Math.sin(a)); });
      }
      const pa = (jetDeg - 90) * D2R, tx = -Math.sin(pa), ty = Math.cos(pa);   // the pointer's direction, and along the arc
      const px = bx + br * Math.cos(pa), py = by + br * Math.sin(pa);
      stroke(() => {
        ctx.moveTo(px, py);
        ctx.lineTo(px - 9 * Math.cos(pa) - 5 * tx, py - 9 * Math.sin(pa) - 5 * ty);
        ctx.lineTo(px - 9 * Math.cos(pa) + 5 * tx, py - 9 * Math.sin(pa) + 5 * ty);
        ctx.closePath();
      });
    }

    // flight path marker: where the airplane is actually going. Held at the
    // HUD's edge and dashed when it leaves the frame; while looking around it
    // is simply where it is, in view or not.
    const frame = { left: left + 30, right: right - 30, top: top + 60, bottom: bottom - 70 };
    const within = (p) => p.visible && p.x >= frame.left && p.x <= frame.right && p.y >= frame.top && p.y <= frame.bottom;
    const f = project(reading.velocity);
    const inFrame = within(f);
    let fpm = null;
    if (f.visible && (inFrame || !looking)) {
      const fx = Math.max(frame.left, Math.min(frame.right, f.x)), fy = Math.max(frame.top, Math.min(frame.bottom, f.y));
      fpm = { x: fx, y: fy };
      dashed(!inFrame);
      stroke(() => {
        ctx.arc(fx, fy, 7, 0, Math.PI * 2);
        ctx.moveTo(fx + 7, fy); ctx.lineTo(fx + 20, fy);
        ctx.moveTo(fx - 7, fy); ctx.lineTo(fx - 20, fy);
        ctx.moveTo(fx, fy - 7); ctx.lineTo(fx, fy - 15);
      });
      dashed(false);
    }

    // the steerpoint (the HNL VORTAC), as Rage's: the diamond on the station
    // when it is in the HUD's frame; otherwise the tadpole, a small circle
    // above the flight path marker with a tail pointing the way to turn
    if (reading.steer) {
      const st = reading.steer, sp = project(st.dir);
      if (within(sp)) {
        stroke(() => { ctx.moveTo(sp.x, sp.y - 9); ctx.lineTo(sp.x + 9, sp.y); ctx.lineTo(sp.x, sp.y + 9); ctx.lineTo(sp.x - 9, sp.y); ctx.closePath(); });
      } else {
        const from = fpm ?? { x: cx, y: cy };
        const u = cueDirection(sp, from, relativeBearing(hdg, st.bearing));
        const tx = from.x, ty = from.y - 34;
        stroke(() => {
          ctx.moveTo(tx + 5, ty); ctx.arc(tx, ty, 5, 0, Math.PI * 2);
          ctx.moveTo(tx + u.x * 5, ty + u.y * 5); ctx.lineTo(tx + u.x * 18, ty + u.y * 18);
        });
      }
      text(steerText(st.range, st.name), right, bottom, 'right', 14);
    }

    numbers();
    // the VSI just above the altitude, lined up with it, the size of G and Mach
    text(vsiText(reading.vsi), at.altitude, cy - 24, 'left', 14);

    // g, angle of attack, Mach and the engine's power, lower left, lined up
    // under the airspeed
    const rows = [bottom - 54, bottom - 36, bottom - 18, bottom], sx = at.airspeed - NUMBER_GAP;
    text(`${reading.g.toFixed(1)} G`, sx, rows[0], 'left', 14);
    text(`α ${reading.alpha.toFixed(1)}`, sx, rows[1], 'left', 14);
    text(`M ${reading.mach.toFixed(2)}`, sx, rows[2], 'left', 14);
    text(powerText(reading.power), sx, rows[3], 'left', 14);
  }

  function clear() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  return { draw, clear };
}

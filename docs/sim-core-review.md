# Wings-v1 sim core review (Claude Fable 5.2, November 10, 2026)

An independent review of the first Wings' flight model (`135crewdog/wings-v1`, `src/sim/`), for milestone 1. Fable read the equations line by line, rebuilt the model in its own standalone script from `docs/flight-model.md`, and cross-checked conventions against Rage's F-16 model. It did not run the repo's own code or tests.

## Part 1: For the owner

**Verdict: trust it with fixes.** The core that moves the airplane through the air is right. The stall and spin part is not, and everything a jet needs is missing.

**What is solid.** The rebuilt model matches the glider's documented numbers (stall 75.1 km/h, best glide 37.1 at 105 km/h, minimum sink 0.708 m/s at 86 km/h). Axes, attitude math, gravity, lift and drag directions, the time-stepping, the standard atmosphere, the landing-gear model and the hand-off to the 3D view are all correct. An F-4-sized airplane flown through the rebuild up to 600 m/s stayed stable.

**What is not.**
1. The spin feature is broken and was never tested. A stalled wing "feeds" a roll with nothing to cap it; full back stick plus full rudder in the glider wound up to thousands of degrees per second, then the math failed.
2. The stall has no real nose drop. On a stubby wing like the F-4's, lift barely fades, so the stall would feel like mush.
3. Nothing limits g or roll rate. An F-4 stand-in pulled 27 g at 400 m/s and rolled 570°/s at 600 m/s.
4. It is a glider model: no engine, no afterburner, and almost no Mach effects.
5. The glider card was tuned to military handling-spec numbers; full back stick at 170 km/h gave about 2.6 g where the wing could give 4.7.

**What reuse means for an F-4.** Keep the motion core, atmosphere, ground contact and view conversion. Rewrite the stall as an explicit curve with a deliberate nose drop and a capped wing-drop tendency. Add an engine (Rage's pattern), Mach effects, and g and roll-rate limits through control power. Later, make a few control effects change with angle of attack for the F-4's roll-with-rudder personality. Drop the eigenvalue machinery, military-spec bounds and per-number source notes. A few focused sessions on a sound base, not a rewrite. Starting from Rage would be worse: its physics is F-16-specific tables that a card can't re-skin.

## Part 2: Technical appendix (for Claude Code)

Paths are in `135crewdog/wings-v1`. "Derived" = checked by hand; "script" = Fable's standalone re-implementation.

### Findings

1. **`src/sim/aero.js:63`, bug (severe).** `Clp_eff = Clp·(1 − (1+A)σ)` is linear negative damping with no saturation. Derived: at σ = 1 near stall speed, roll rate grows as e^(4.5t). Script: stock card (A = 0.5), full back stick and full rudder exceeded 16,000°/s by 18 s, then NaN. σ = 1 also at any α beyond stall, including tumbling. Minimum fix: saturate (`Cl += Clp·p̂ − Clp·(1+A)·σ·p0·tanh(p̂/p0)`, p0 ≈ 0.1) and gate σ to |α| < ~60°. Better fix (chosen by the owner): two wing halves with local α = α ± p·y/V, giving roll damping, autorotation, its natural limit and some adverse yaw from one mechanism.
2. **`src/sim/sim.js:61-73`, risk.** No finite-state guard; one NaN freezes the game. Check `Number.isFinite` each step; treat failure as a crash or reset; clamp body rates.
3. **`docs/flight-model.md:225`, card targets, risk.** "Spins are section 13" but there is no section 13; no test covers a spin, loop, roll or inverted flight.
4. **`src/sim/aero.js:67`, risk.** Cm is linear in α with no stall term; nose drop comes only from lift loss (script: a 23–27° α mush). Cm flips sign at α = ±180°. Fix: a σ·Cm_stall nose-down break; optionally fade elevator power with σ; use sin α beyond ~30°.
5. **`src/sim/card.js:79-105` with `src/sim/aero.js:19-22`, risk for jets.** The first-peak solve fails for low aspect ratio (F-4: AR 2.8, CLmax 1.05 has no solution at softness ≥ 3°; at 2°, post-stall CL stays 0.90–1.0). Fix: an explicit lift curve from (CLmax, α_stall, post-stall drop, width); no solver.
6. **`src/sim/sim.js` / `aero.js`, risk for jets.** No g or roll-rate limit (`g_max` only used in `performance.js:17`). Fix: elevator power fading above a reference dynamic pressure so full stick ≈ g limit; aileron power fading likewise.
7. **`src/sim/aero.js:30-34`, `card.js:123`, missing for jets.** Wave drag capped at M = 1; CLα (Helmbold) has no sweep or Mach term; nothing varies with Mach or α; no thrust anywhere.
8. **`src/sim/aero.js:84-85, 113`, risk.** The wing sees full q̄ whatever the sideslip; α = atan2(w, u) is ill-conditioned near β = 90°. Fix: x-z-plane speed for wing terms plus a cross-flow drag term.
9. **`data/aircraft/twin-ii-acro.json:39, 50`, tuning.** Cmq −30 with elevator power 0.12 limits full back stick to 2.59 g at 170 km/h. Fix: derive elevator power from "full stick reaches the g limit at corner speed."
10. **Same card, lines 52 and 44, nit.** Rudder power 0.035 against Cnβ 0.06 gives ~28° sideslip at full rudder: too much, and what tips finding 1 over.
11. **`src/sim/vec.js`, fine (derived).** Hamilton product, body-to-world rotation and ZYX Euler correct; same convention as Rage.
12. **`src/sim/body.js:11-23`, fine (derived).** Equations of motion correct. Rage also carries Ixz and engine angular momentum; diagonal inertia is fine for a game.
13. **`src/sim/body.js:35-47`, fine (derived, script).** RK4 with renormalization; held trim to 0.06 m/s over 60 s; F-4 aero rates far below the step's stability limit.
14. **`src/sim/atmosphere.js`, fine (derived).** ISA correct; values held above 20 km.
15. **`src/sim/aero.js:102, 114-119`, fine.** Lift perpendicular to the airflow, drag along it, moment arms correct.
16. **Derivative and control signs, fine (derived).** Including the auto-rudder and load-factor signs in `src/input/assists.js`.
17. **`src/sim/contact.js`, fine (derived).** Correct forces and moments; stiffness within the step's limit for an F-4-weight gear. Limits: flat ground only, no static friction, no fuselage or fin contact points, wheel brake hard-wired to the airbrake.
18. **`src/sim/contact.js:83-96`, fine.** Touchdown check uses the pre-step state correctly.
19. **`src/sim/trim.js`, fine for gliders.** Needs a level-flight trim with thrust for jets; Rage's `trim.js` is the pattern.
20. **`src/sim/handling.js`, `eigen.js`, fine but not needed.** Minor nits at `handling.js:110` and `:59-60`.
21. **`src/render/frames.js`, `src/app.js:195-216`, fine.** NED-to-Three mapping, CG offset, accumulator and interpolation correct.
22. **`src/sim/aero.js:83, 109`, fine.** Cut-off below 1 m/s is harmless.
23. **`src/sim/performance.js:15`, nit.** Stall-speed search re-run per call (tooling only).
24. **`src/sim/card.js:137`, nit.** c̄ = S/b is not the MAC (F-4: 4.18 m versus about 4.9 m).
25. **Per-step small-array allocation, nit.** Fine at 120 Hz unless profiling says otherwise.

### What an F-4 needs added

- **Engine:** thrust along body x from throttle, Mach and altitude, with spool lag and an afterburner stage; Rage's `src/sim/engine.js` structure, scaled by the card's thrust.
- **Mach:** drag rise through and past M = 1, calibrated against thrust to hit the card's top speeds (Rage's `dragRise`); Prandtl–Glauert and sweep on CLα; KCAS and Mach from Rage's `airdata.js`.
- **High-α personality (later):** Cnβ falling with α, aileron yaw turning strongly adverse while aileron roll power fades, rudder staying effective.
- **Stall and departure:** findings 1, 4 and 5, plus a buffet cue from σ.
- **Limits:** findings 6 and 9.
- **Systems:** flaps, gear with drag, nosewheel steering, brakes, a level-flight trim.

### Keep / simplify / drop

| File | Recommendation |
|---|---|
| `vec.js`, `atmosphere.js` | Keep as is |
| `body.js` | Keep; optionally add engine state |
| `sim.js` | Keep; add thrust, a NaN guard and limits |
| `contact.js` | Keep; generalize the brake; contact points per card |
| `aero.js` | Keep the structure, air data, force assembly and ground effect; rewrite lift, stall and autorotation; add α and Mach schedules |
| `card.js` | Simplify heavily into the "pilot numbers to coefficients" deriver; drop the blend solver |
| `trim.js` | Simplify to a level-flight trim with thrust |
| `performance.js` | Optional |
| `handling.js`, `eigen.js` | Drop |
| Card source notes and most targets | Drop; keep a few checkride targets |

### Pilot numbers to coefficients

| Pilot number | Drives |
|---|---|
| Weight | Mass |
| Span, wing area, sweep | Aspect ratio, chord, lift-curve slope, induced-drag factor |
| Length and span | Inertia, through typical radius-of-gyration fractions |
| Stall speed | CLmax = 2W / (ρ S Vs²) |
| Top speed with thrust | CD0 from thrust = drag at top speed; the high top speed sets the wave-drag peak |
| MIL and afterburner thrust | Engine scale |
| g limit | Elevator power, so full stick reaches the limit at corner speed (Vs·√g) |
| Roll rate at a reference speed | Aileron power, from roll damping |
| Stall sharpness, nose drop, spin tendency | Stall width, Cm break, autorotation strength |

Damping terms come from geometry defaults.

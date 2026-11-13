# Wings

A flight sim game for the iPhone, in the spirit of Eric Parker's PocketWings: a big invented island to explore, "Watopia for pilots," and cool airplanes that fly well and look right. The first airplane is an F-4C Phantom II, the Vietnam-era jet Robin Olds flew. It's a game, not a training simulator: fun first, believable second.

It's a home-screen web app at `https://135crewdog.github.io/wings/`. Solo only. No missions, combat, scores or weather.

The owner is a USAF KC-135 instructor pilot, not an engineer. He builds these apps to learn and to have fun. He knows how airplanes fly and feel. He does not know, and should never be asked about, coefficients, damping ratios or the equations behind them.

## Pillars

From the owner's design philosophy (https://135crewdog.github.io/hig/), which applies to everything a person sees or touches:

- **Simple.** Fewer files, features, settings and words. When in doubt, leave it out.
- **Future-proof.** Works offline, depends on as little as possible, keeps working for years.
- **Efficient.** Do each piece of work once; one general rule beats many special cases.
- **Fun.** If it doesn't make the airplane fly well, look right, or make the island worth exploring, it doesn't belong.

## How we work

1. The owner writes one prompt, for milestone 0, and never another. When a milestone is done, Claude Code proposes the next one itself, in Plan Mode, from this file and `docs/`. The owner and Claude Code iterate, and the owner approves.
2. Claude Code builds in pull requests, each small enough for the owner to check on his phone in about a minute.
3. Codex reviews every pull request automatically. Claude Code fixes what it finds.
4. The owner authorizes the merge; Claude Code merges. Never merge unasked.
5. The owner checks the app on his phone and gives feedback. Claude Code carries on.
6. Back to Plan Mode only when a big new chunk of work needs planning.

Rules for Claude Code:

- **Ask the owner pilot questions, never engineering ones.** Not "what should the pitch damping be?" but "after a stall, should the nose drop harder?" Engineering choices are Claude Code's to make, test and write down.
- **Every pull request description ends with "What this teaches":** one to three ideas from it, in plain words, the way you'd explain them to a pilot who isn't a programmer.
- **Build only the current milestone.** Nothing appears in the app that the owner didn't ask for. Propose, don't add.
- **When a test can't pass, stop and report what you found, in pilot terms, with numbers.** Never loosen a test to make it pass.
- **Ideas go to the Ideas doc** (below). When the owner says "idea: …", add it there. Never build from the Ideas doc until the owner picks an idea.

## Where things live

One home for each kind of thing. Nothing lives in two places.

| What | Home |
|---|---|
| Code, docs, this file, finished 3D models (.glb): anything the app needs | This repo |
| Working files: reference photos and drawings, Blender files | The `Wings` folder in the owner's Google Drive, synced to his laptop by Google Drive for desktop |
| Ideas: unstructured, anything goes | The `Ideas` Google Doc in that Drive folder |
| Brainstorming, big decisions, and building 3D models | Chats in the owner's "Wings" Claude project |

The old projects are references, never inherited wholesale. Copy a piece in on purpose, and say where it came from:
- `135crewdog/wings-v1`: the first Wings. Its sim core and tilt input are the starting point for milestone 1, with the fixes in `docs/sim-core-review.md`.
- `135crewdog/rage`: the F-16 sim. Its iPhone platform rules, update offer, engine model and terrain engine are proven.

## Flying

- **One physics model flies every airplane:** a rigid body with lift, drag, thrust and weight. Stalls, spins, energy bleed in a hard turn and the nose falling through the horizon all come from the physics. Nothing is scripted.
- **Each airplane is a card** of numbers a pilot recognizes:
  - From a public spec sheet: weight, span, wing area, sweep, length, MIL and afterburner thrust, clean and landing stall speeds, takeoff rotation speed, top speed low and high, g limit, roll rate.
  - Tuned by feel on the phone: neutral speed, stall sharpness, nose drop, spin tendency, gear and flap drag.

  Claude Code derives every engineering coefficient from these behind the scenes. The owner never sees or sets one.
- **The stall** follows the lift curve from flight school: straight up to max lift, then a drop. Approaching it, the camera shakes like buffet. How it breaks belongs to the airplane: the card's nose-drop number runs from a nose-high mush with a high sink rate (the F-4) to a clear nose drop. A sloppy stall in a turn can drop a wing and start a spin. Let go and it recovers.
- **Limits come from the airplane, not a limiter.** Top speed is where thrust meets drag. Elevator power fades with speed, so full tilt gives about the card's g limit at any speed above corner; below corner the wing stalls first. Slow, with the wing at a low angle, back stick has extra bite, so the nose comes off the runway at a sensible speed. Roll power fades at high speed the same way. No consequence for over-g. Gear and flaps have no limit speeds.
- **Crashes are forgiving:** only a hard impact ends the flight. Scrapes and wingtip touches survive. What counts is how fast the airplane closes with the ground under it: on the level that is its sink rate, and into a hillside it is most of its speed. Water is the exception: any touch of the sea or a loch ends the flight. A **crash override** switch on the pause screen, on by default, turns crashes off altogether: with it on, nothing ends a flight but the pilot.
- **Standard atmosphere,** always a standard day. No wind, weather, thermals or turbulence.
- **Constant weight.** No fuel burn.
- **Tests are a checkride:** maneuvers flown headless, with results in knots, feet, degrees and g, next to the card's numbers. Card numbers pass within a tolerance set once in the milestone 1 plan: about ±5 knots on stall and rotation speeds, ±5% on top speeds, ±10% on g and roll rate. Feel numbers have no pass/fail; the checkride just reports them. No eigenvalue analysis, no military-spec pass/fail gates, no source notes on every number.

## Controls and screen

- **Tilt for pitch and roll,** the phone held in landscape like a steering wheel. Tilt is the elevator, PocketWings style: with the phone at neutral, the airplane is trimmed for the card's neutral speed. Faster than that, the nose rises, as with fixed trim in a real airplane, so you hold the phone farther forward the faster you go.
- **Throttle:** a slider on the left edge.
- **Three toggle buttons:** gear (up/down), flaps (up/down), brakes (wheel brakes; tap on, tap off).
- **One small pause button.** The pause screen holds Resume, Restart, Recenter and the crash override switch.
- **Auto-coordination on every airplane.** There's no rudder control: automatic feet hold the rudder against sideslip and damp the nose's swing. On the ground, tilt steers the nosewheel.
- **A chase camera,** behind and above the airplane, turning with it a beat late, so the airplane stays upright on screen and the horizon tilts. A finger dragged across the view swings the camera around the airplane, as in Rage; let go and it comes back.
- **Readouts:** airspeed in knots and altitude in feet. Below 2,000 feet above the ground, radar altitude too. Nothing else.
- **No other on-screen controls.** US units only, with no units setting.
- **The start screen** has the game's name and a Fly button. The version, with any model credit beside it, shows on the start and pause screens only.

## Looks

- **Airplanes must look right to a pilot.** The shape and proportions matter; tiny details nobody sees from the chase camera don't. Two rounds of revision per model, unless the owner asks for more.
- **3D models are built in separate Claude chats, not by Claude Code.** In a Wings project chat on the owner's laptop, Claude drives his visible Blender through the Blender connector, never a hidden or background copy. The chat saves the Blender file and exports the `.glb` to `Wings/Blender/` in Drive. The owner attaches the `.glb` to the Claude Code chat, because the Drive connector can't see files that come from the laptop. Claude Code puts it in this repo and in the app.
- **`docs/models.md` is the handoff:** what the app needs from a model (real size, which way is forward, the origin at the centre of gravity, five named motions for the gear, flaps and controls, named wheels, a size budget). Claude Code writes it and keeps it current; the model chats build to it. A test checks every model against it.
- **The F-4C in the app is the owner's own,** built in Blender with Claude in a Wings chat. It replaced a stand-in in version 0.0.13. A new or revised model is swapped in the same way: he attaches the `.glb`, and Claude Code checks it, reads its wheels into the card, re-flies the checkride and opens one small pull request.
- **Markings:** real aircraft types and real military style (camouflage, national insignia). Tail codes, serials and units are invented unless the owner says otherwise. Nose art and kill markings are his call: his F-4C carries Robin Olds's "SCAT XXVII" and MiG-kill stars. Airlines, resorts and other brands on the island are invented too.

## The world

One big invented island, sized for a jet: minutes to cross at 500 knots, with at least one runway long enough for an F-4. It gets designed in its own conversation before its milestone.

The island is designed in `docs/island.md` and its land is in the app: every flight starts on the numbers of runway 28 at the air base, with gear and flaps down and the brakes on. The land's shape is a height map in `terrain/`, written by a script and read by both the flight model and the picture. The old flat test field (`FIELD` in `src/field.js`) is kept only for the headless tests, until milestone 4 closes.

## Building it

- Plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no bundler, no TypeScript.
- Three.js is the one runtime library, vendored in `vendor/three/` at a pinned version. Ask before adding any other dependency.
- Tests use Node's built-in runner (`node --test`).
- The simulation (`src/sim/`) contains no browser, DOM or Three.js code.
- Target: 60 fps on an iPhone 16.
- **iPhone platform rules** (proven in Rage):
  - Motion permission is requested synchronously inside the Fly tap, over HTTPS.
  - iOS ignores orientation lock, so show a rotate screen in portrait.
  - Request a screen wake lock in the Fly tap and on Resume and Restart, and hold it only in flight: let it go on the pause, crashed and start screens, so a phone put down with the app open can sleep.
  - Draw only while something is moving: every frame in flight, and otherwise a few frames after a change, then rest.
  - The app is full screen, `display: standalone` with `viewport-fit=cover`. Controls and text stay inside the safe area.
  - No scrolling, zooming or selecting.
  - Pause automatically when the app is hidden; resume only from the pause screen.
  - The origin `135crewdog.github.io` is shared with the owner's other apps. Prefix every cache with `wings-` and every storage key with `wings.`, and only ever delete caches that start with `wings-`. Every path is relative (`./`).
  - The service worker never calls `skipWaiting()` on its own. New versions are offered on the start or pause screen only, never mid-flight.
- **Versions:** `APP_VERSION` in `src/version.js`, the service worker's cache name and a line in `CHANGELOG.md` all change together on every deploy that changes what a player sees.

## Milestones

| # | Milestone | Done when |
|---|---|---|
| 0 | **Setup.** Repo, Pages, connectors, Drive folder, an empty app shell | A test pull request goes through Codex review, merges and deploys; the empty app installs on the owner's iPhone and takes an update |
| 1 | **The sim core.** Wings-v1's core, fixed and simplified; the F-4C card; the checkride | The F-4C flies its checkride headless and the results match its card within the tolerances |
| 2 | **An F-4 in the app.** Claude Code writes `docs/models.md`, converts the stand-in F-4 to it, and puts it in the app with moving control surfaces, gear and flaps | The owner approves the stand-in in the app |
| 3 | **First flight.** The F-4C over a plain test field with a runway, on the phone | The owner takes off, flies and lands the F-4C on his iPhone |
| 4 | **The island** | Designed first, in its own conversation |

Milestones 0 to 3 are done. Milestone 4 is next.

Every milestone starts deliberately in Plan Mode. Claude Code plans each one when the one before it is done; nobody writes a prompt for it. The island is the one exception: it's designed in a chat with the owner first and written to `docs/island.md`, then planned the same way. Any part of the world built in Blender is built in a model chat, like the airplanes. Anything beyond milestone 4 lives in the Ideas doc until the owner picks it.

Notes for planning:
- **Milestone 1** is large and all headless, so plan it as pull requests in this order: the core copied in, with the safety net and the checkride harness; the lift curve and stall; the engine and Mach; the limits; the ground systems (gear, flaps, brakes, steering, trim). In `docs/sim-core-review.md`, findings 8, 10 and 23–25 are optional. Besides the card's numbers, the checkride reports the g from full back tilt at 250, 350 and 450 knots, and the tilt needed for level flight at 250, 450 and 600 knots, so the feel shows before it reaches the phone.
- **Milestone 2:** the sim's wheels must be where the model's wheels are. The card carries the wheel and airframe contact positions, read from the model file, and a test fails if the two disagree, so a model can't be swapped without the sim following. The model's wheels are where they rest under the airplane's weight. A test also checks each control surface's travel against `docs/models.md`. The F-4C's centre of gravity is where the owner's model puts it: 3.5 feet ahead of the main wheels.
- **The owner's F-4C:** reference images go in `Wings/Reference/` in Drive, the Blender file and the exported `.glb` in `Wings/Blender/`, and the finished `.glb` in this repo as `models/f4c.glb`.
- **Carried forward from milestone 3,** none of it blocking:
  - Takeoff rotation is settled: rotation speed is a card number (150 knots for the F-4C, the owner's figure), graded by the checkride. The flight model sizes extra back-stick bite to meet it: bite at a low angle of attack, fading out by the stall angle and by corner speed (`elevatorPower` in `src/sim/aero.js`, sized in `src/sim/card.js`). With the stick full back the F-4C's nose wheel lifts at 150 and the jet lifts off at about 174. Two simpler fixes were tried and dropped: doubling the elevator's low-speed power made a full-back-stick turn fall out of the sky, and a thrust line below the centre of gravity pitched the nose up hard with every throttle change.
  - The flight model rolls every airplane as if it had ordinary ailerons, and that is settled: the F-4's spoilers are only in the picture. Flown both ways, a slow full-tilt roll differs by under a degree of sideslip, because the automatic feet cancel it. An airplane that really rolls with spoilers, a KC-135 for example, is flown the same way.
  - With the crash override on, the jet can come to rest on its back; the way out is Pause, then Restart.
  - The Pages deploy once failed at GitHub's publish step for no fault of the repo; a fresh run of the workflow fixed it where re-runs didn't. If it recurs, update the action versions in `.github/workflows/pages.yml`.

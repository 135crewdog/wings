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
  - From a public spec sheet: weight, span, wing area, sweep, length, MIL and afterburner thrust, clean and landing stall speeds, top speed low and high, g limit, roll rate.
  - Tuned by feel on the phone: neutral speed, stall sharpness, nose drop, spin tendency, gear and flap drag.

  Claude Code derives every engineering coefficient from these behind the scenes. The owner never sees or sets one.
- **The stall** follows the lift curve from flight school: straight up to max lift, then a drop. Approaching it, the camera shakes like buffet. How it breaks belongs to the airplane: the card's nose-drop number runs from a nose-high mush with a high sink rate (the F-4) to a clear nose drop. A sloppy stall in a turn can drop a wing and start a spin. Let go and it recovers.
- **Limits come from the airplane, not a limiter.** Top speed is where thrust meets drag. Elevator power fades with speed, so full tilt gives about the card's g limit at any speed above corner; below corner the wing stalls first. Roll power fades at high speed the same way. No consequence for over-g. Gear and flaps have no limit speeds.
- **Crashes are forgiving:** only a hard impact ends the flight. Scrapes and wingtip touches survive.
- **Standard atmosphere,** always a standard day. No wind, weather, thermals or turbulence.
- **Constant weight.** No fuel burn.
- **Tests are a checkride:** maneuvers flown headless, with results in knots, feet, degrees and g, next to the card's numbers. Card numbers pass within a tolerance set once in the milestone 1 plan: about ±5 knots on stall speeds, ±5% on top speeds, ±10% on g and roll rate. Feel numbers have no pass/fail; the checkride just reports them. No eigenvalue analysis, no military-spec pass/fail gates, no source notes on every number.

## Controls and screen

- **Tilt for pitch and roll,** the phone held in landscape like a steering wheel. Tilt is the elevator, PocketWings style: with the phone at neutral, the airplane is trimmed for the card's neutral speed. Faster than that, the nose rises, as with fixed trim in a real airplane, so you hold the phone farther forward the faster you go.
- **Throttle:** a slider on the left edge.
- **Three toggle buttons:** gear (up/down), flaps (up/down), brakes (wheel brakes; tap on, tap off).
- **One small pause button.** The pause screen holds Resume, Restart and Recenter.
- **Auto-coordination on every airplane.** There's no rudder control. On the ground, tilt steers the nosewheel.
- **Readouts:** airspeed in knots and altitude in feet. Below 2,000 feet above the ground, radar altitude too. Nothing else.
- **No other on-screen controls.** US units only, with no units setting.

## Looks

- **Airplanes must look right to a pilot.** The shape and proportions matter; tiny details nobody sees from the chase camera don't. Two rounds of revision per model, unless the owner asks for more.
- **3D models are built in separate Claude chats, not by Claude Code.** In a Wings project chat on the owner's laptop, Claude drives his visible Blender through the Blender connector, never a hidden or background copy. The chat saves the Blender file and exports the `.glb` to `Wings/Blender/` in Drive. The owner attaches the `.glb` to the Claude Code chat, because the Drive connector can't see files that come from the laptop. Claude Code puts it in this repo and in the app.
- **`docs/models.md` is the handoff:** what the app needs from a model (scale, which way is forward, which parts move and where they pivot, size budget). Claude Code writes it and keeps it current; the model chats build to it.
- **Markings:** real aircraft types and real military style (camouflage, national insignia). Tail codes, serials, nose art and units are invented. Airlines, resorts and other brands on the island are invented too.

## The world

One big invented island, sized for a jet: minutes to cross at 500 knots, with at least one runway long enough for an F-4. It gets designed in its own conversation before its milestone.

## Building it

- Plain HTML, CSS and JavaScript (ES modules). No framework, no build step, no bundler, no TypeScript.
- Three.js is the one runtime library, vendored in `vendor/three/` at a pinned version. Ask before adding any other dependency.
- Tests use Node's built-in runner (`node --test`).
- The simulation (`src/sim/`) contains no browser, DOM or Three.js code.
- Target: 60 fps on an iPhone 16.
- **iPhone platform rules** (proven in Rage):
  - Motion permission is requested synchronously inside the Fly tap, over HTTPS.
  - iOS ignores orientation lock, so show a rotate screen in portrait.
  - Request a screen wake lock in the Fly tap, and again when the app becomes visible.
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
| 2 | **The F-4C model.** Claude Code writes `docs/models.md`; a model chat builds the F-4C to it; Claude Code puts it in the app with moving control surfaces, gear and flaps | The owner approves it in the app |
| 3 | **First flight.** The F-4C over a plain test field with a runway, on the phone | The owner takes off, flies and lands the F-4C on his iPhone |
| 4 | **The island** | Designed first, in its own conversation |

Every milestone starts deliberately in Plan Mode. Claude Code plans each one when the one before it is done; nobody writes a prompt for it. The island is the one exception: it's designed in a chat with the owner first and written to `docs/island.md`, then planned the same way. Any part of the world built in Blender is built in a model chat, like the airplanes. Anything beyond milestone 4 lives in the Ideas doc until the owner picks it.

Notes for planning:
- **Milestone 1** is large and all headless, so plan it as pull requests in this order: the core copied in, with the safety net and the checkride harness; the lift curve and stall; the engine and Mach; the limits; the ground systems (gear, flaps, brakes, steering, trim). In `docs/sim-core-review.md`, findings 8, 10 and 23–25 are optional. Besides the card's numbers, the checkride reports the g from full back tilt at 250, 350 and 450 knots, and the tilt needed for level flight at 250, 450 and 600 knots, so the feel shows before it reaches the phone.
- **Milestone 2** starts with `docs/models.md`, before the model chat begins. Reference images go in `Wings/Reference/` in Drive, the Blender file in `Wings/Blender/`, and the finished `.glb` in this repo.

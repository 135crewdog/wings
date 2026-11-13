# What the app needs from a 3D model

This is the handoff between a model chat and the app. There are two kinds of model: **airplanes**, which this page covers first, and **landmarks** on the island (the viaduct, the castle, the Strip's hotels), which have their own shorter rules near the end.

A model chat builds an airplane in Blender to these rules and exports one `.glb`. The app can then show it, move its parts and land it on its wheels without any code written for that airplane. `tests/model.test.js` checks a model against this page.

Claude Code writes this page and keeps it current. If a rule here is impractical in Blender, say so in the model chat and the owner brings it back; don't work around it.

## Size and which way is which

- **Real size, in metres.** An F-4C is 17.7 m long with a span of 11.7 m. The test allows 2% either way.
- **Axes in the exported file:** nose along −Z, right wing along +X, up along +Y. In Blender, which has Z up, that means the nose points along +Y and the right wing along +X; the glTF exporter's "+Y Up" option (on by default) does the rest.
- **The origin is the centre of gravity.** Put the model's origin where the real airplane balances, taken from the reference drawings: on the centreline, about a third of the way back along the wing's mean chord, which on the F-4 is a little ahead of the main wheels. The simulation turns and pitches the airplane around this point, so a wrong origin makes it look as if it pivots about its nose or tail.
- Apply rotation and scale to every object before animating anything (Ctrl-A, "Rotation & Scale"), so the file carries no hidden scaling. Not "All Transforms" and not "Location": those move each object's origin to the middle of the scene, which throws away the hinges below.

## The parts that move

Every moving part is its own object, with its origin on its hinge line, so it rotates where the real one does.

The app does not know any airplane's hinges or angles. It only knows **five named motions**, which every model must have. Each is an animation (a Blender action, exported as a glTF animation) of **exactly one second**, and the app sets the time to say where the part is. The time is the position:

| Name | 0 s | 0.5 s | 1 s |
|---|---|---|---|
| `gear` | up, doors closed | part way | down and locked |
| `flaps` | up | part way | fully down |
| `elevator` | full forward stick: trailing edge down | neutral | full back stick: trailing edge up |
| `aileron` | full left stick: the airplane rolls left | neutral | full right stick: it rolls right |
| `rudder` | full left: trailing edge left | neutral | full right |

Rules for the motions:

- **Names are exact,** lower case, as in the table.
- **`aileron` moves whatever rolls the airplane, the way the real one does.** On most airplanes that is two ailerons, one up and one down. The F-4 is different: its ailerons only go down, and a spoiler on top of the other wing comes up. For a left roll the right aileron goes down and the left spoiler rises, while the left aileron stays put; a right roll is the mirror image; at neutral everything is flush.
- **One motion may move many parts.** `gear` moves all three legs and every door. `flaps` moves every flap panel, leading and trailing edge. `aileron` moves both ailerons, and the spoilers too if the airplane rolls with them, as the F-4 does.
- **A part belongs to one motion only.** The app runs all five at once, so two motions moving the same part would fight.
- **Frame rate:** set the scene to 24 frames per second and key frames 0, 12 and 24. Use linear interpolation between keys, so half way in time is half way in travel. The exporter may write a key for every frame; that is fine.
- **The file's own resting pose doesn't matter.** The app sets all five motions before it draws anything, and the tools and tests pose the model the same way: gear down, flaps up, controls at 0.5 s.
- **Deflections are the real airplane's.** Check them against the references; for the F-4C they are about: stabilator 21° trailing edge up to 9° down; ailerons 30° down, with the spoiler on the other wing up 45°; rudder 30° each way; trailing-edge flaps 60°.
- The gear should take its whole second: doors opening first, legs swinging down after.
- **A model may carry other motions,** such as `speedbrake` on the F-4C. The app leaves any it doesn't know at 0 s, so 0 s must be the closed, flush position. No spinning wheels, no pilots' heads.

## The wheels

Three objects named exactly `wheel_nose`, `wheel_left` and `wheel_right`: the tyres. If a leg has two tyres, as the F-4's nose leg does, join them into one object. They may be children of their gear legs: they are measured where they end up with the gear down. The simulation reads where each one touches the ground with the gear down, so that the airplane sits and rolls on the wheels you can see.

Model the gear at its length with the airplane's weight on it, not hanging fully extended. The simulation stands the airplane on its tyres exactly as modelled; its springs take up from there.

## Looks

- **Shape and proportions come first:** the planform, the tail, the intakes, the canopy line. Fine detail nobody sees from a chase camera 30 m away isn't worth its triangles.
- **Markings:** a real paint scheme and national insignia. Tail codes, serials and unit badges are invented unless the owner says otherwise. Nose art and kill markings are his call: his F-4C carries Robin Olds's "SCAT XXVII" and MiG-kill stars. The owner settles the scheme and what hangs under the wings in the model chat.
- **Gear bays and flap gaps** should look right when open: no see-through holes into an empty fuselage.
- Smooth shading with sharp edges marked where the real airplane has them, or flat shading throughout: whichever suits the model.

## Budget

- The `.glb` is under **2 MB**.
- Under **50,000 triangles.**
- **One material, single-sided, and up to two textures**, each up to 1024 × 1024 pixels, packed into the file: base colour, and optionally roughness with metalness in the standard glTF layout. No normal or emission maps.
- No cameras, lights, empties left over from modelling, or hidden objects.

## Exporting

File → Export → glTF 2.0, format **glTF Binary (.glb)**, with: +Y Up on; Apply Modifiers on; Animations on, with one glTF animation per action (animation mode "Actions"); and everything else left at its default.

Save the Blender file and the export side by side in `Wings/Blender/` in Drive, as `f4c.blend` and `f4c.glb`. The owner then attaches the `.glb` to the Claude Code chat.

## What happens to it in the app

Claude Code puts the file at `models/f4c.glb`, reads the wheel positions and the airplane's outline from it into the airplane's card, and re-flies the checkride. If the test finds a rule broken, Claude Code reports exactly what is off for the model chat to fix. The owner gets two rounds of revision on the look, unless he asks for more.

## Landmarks

A landmark is a thing that stands on the island: the viaduct, the castle, the stadium, Durdle Door, a hotel on the Strip. It doesn't move, so it has none of an airplane's motions or wheels. What it has instead is a place to stand and a set of solid shapes. `docs/island.md` says what each landmark is; the prompt for each model chat gives its sizes.

### Size, and which way is which

- **Real size, in metres,** like the airplanes: the person who fits the F-4's cockpit can walk through its doors. The prompt gives the overall sizes; the test allows 5% either way.
- **Axes in the exported file:** north along −Z, east along +X, up along +Y. In Blender that is north along +Y, east along +X, up along +Z. The prompt says which way the landmark faces. The app may turn it a few degrees to fit the ground.
- **The origin is on the ground, in the middle.** Put the model's origin at the centre of its footprint, at the level of the ground it stands on (for the viaduct, the river bed under its middle). The app sets the origin on the land at the landmark's site.
- **Carry on below the ground.** Walls, piers and legs go 5 m below the origin's level, because the real ground is never perfectly flat and a gap under a wall shows.
- Apply rotation and scale to the parts you can see, as for airplanes.

### Bigger than life, where the F-4 has to fit

Anything meant to be flown through is opened up for a jet with a 38-foot wingspan: **every opening at least 35 m wide and 40 m tall** (115 by 130 feet), with nothing hanging in it. That goes for the viaduct's arches and Durdle Door. The prompt names the openings.

### The solid shapes

The flight model can't use the picture to tell what is solid. Each landmark carries its own plain stand-ins for that:

- **Boxes, and only boxes.** For every solid part, add a cube and move, turn and stretch it until it just wraps that part: one for each pier, one for the deck, one for each tower, one for each wing of a building. A sloping roof gets a box up to its ridge; nobody will notice the difference at 300 knots.
- **Name each one `solid` and a number or word:** `solid_pier_3`, `solid_deck`, `solid_tower_east`. The app hides everything whose name starts with `solid` and builds the landmark's solid shapes from them.
- **Leave their transforms alone.** A solid is a plain cube with a location, a rotation and a scale. Do not apply its rotation or scale, and do not edit its mesh; the app reads the cube's place, tilt and size from the object itself.
- **Openings stay open.** No box may cross an opening that is meant to be flown through. Keep the boxes tight to the stone on both sides of each arch, so the hole in the solid shapes is as big as the hole in the picture. The test flies the middle of every named opening and fails if it hits a box.
- **Not too many.** Up to 60 boxes for a big landmark; a hotel should need a handful.
- With crashes on, the jet touching a box ends the flight. With the crash override on, it flies through.

### Looks and budget

- The same painted look as the airplanes: flat colours, flat or smooth shading, no photographs. Stone is dark grey, roofs near black, unless the prompt says otherwise.
- **Signs and names are invented.** The shape may be a famous one; no real brand, logo or name appears on it.
- The `.glb` is under **500 KB** and under **8,000 triangles** (the castle may have 15,000). One material, single-sided, one base-colour texture up to 512 × 512, or none at all with the colours in the material or the vertices.
- No animations, cameras, lights or empties. The solids are the only objects that aren't seen.
- Export as for airplanes. Save the Blender file and the export side by side in `Wings/Blender/` in Drive, named for the landmark: `viaduct.blend` and `viaduct.glb`. The owner attaches the `.glb` to the Claude Code chat.

### What happens to it in the app

Claude Code puts the file at `models/<name>.glb`, reads its solid boxes into the island's list of landmarks, checks it against this page, flies its openings headless, and opens one small pull request. Until a landmark's model arrives, its site is bare ground.

## The model in the app today

`models/f4c.glb` is the owner's own F-4C, built in Blender with Claude in a Wings project chat. It carries a sixth motion, `speedbrake`, which the app doesn't use yet. `models/CREDITS.md` has its history.

`node models/measure.mjs models/f4c.glb` prints a model's wheel and contact positions, to copy into its card.

`models/viaduct.glb` is the owner's viaduct, the first landmark; `models/castle.glb` is his castle school, and `models/door.glb` his Durdle Door. `node models/solids.mjs models/viaduct.glb` prints a landmark's solid boxes.

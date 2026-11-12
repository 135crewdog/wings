# What the app needs from a 3D model

This is the handoff between a model chat and the app. A model chat builds an airplane in Blender to these rules and exports one `.glb`. The app can then show it, move its parts and land it on its wheels without any code written for that airplane. `tests/model.test.js` checks a model against this page.

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

## The model in the app today

`models/f4c.glb` is the owner's own F-4C, built in Blender with Claude in a Wings project chat. It carries a sixth motion, `speedbrake`, which the app doesn't use yet. `models/CREDITS.md` has its history.

`node models/measure.mjs models/f4c.glb` prints a model's wheel and contact positions, to copy into its card.

# Credits for the 3D models

## `f4c.glb`: the stand-in F-4

"[FREE F-4 Phantom low poly](https://sketchfab.com/3d-models/free-f-4-phantom-low-poly-4cd9a24404954246a13394f1def64431)" by [Artbor](https://sketchfab.com/Artbor), licensed under [Creative Commons Attribution 4.0](https://creativecommons.org/licenses/by/4.0/).

It stands in until the owner's own F-4C replaces it. The app credits it on screen, beside the version.

Changed for Wings, by `convert-standin.mjs`:

- Scaled to the real F-4C: 17.74 m long. Its span was 6% short for its length, so it is stretched across the span to 11.70 m.
- Its origin moved to an estimated centre of gravity: 0.6 m ahead of the main wheels and 2.0 m above the runway.
- Its twelve animations replaced by the five motions of `docs/models.md`: gear, flaps, elevator, aileron and rudder. The poses are the author's, except:
  - the rudder, which he gave no motion: it now swings 25° each way about its leading edge;
  - the ailerons, which his clips move together, up and down: they now move as the real F-4's do, down only, with the spoiler rising on the other wing;
  - the gear legs, which shrink to nothing over the last tenth of the way up, because the wheels are thicker than the wing they fold into.
- Its tyres renamed `wheel_nose`, `wheel_left` and `wheel_right`.

Nothing about its shape or its texture is changed.

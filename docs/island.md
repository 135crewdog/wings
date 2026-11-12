# The island

What the island is, as the owner designed it in conversation. Milestone 4 is planned from this file. Distances are nautical miles.

## The idea

One invented island, about 20 miles across, made of three places a pilot from Britain would know at a glance. It is built to grow: more locales, more kinds of terrain and more points of interest get added over time, and the island gets bigger to hold them.

At 500 knots, 10 miles takes 72 seconds: coast to coast is under two and a half minutes, and the air base to the highlands or to the south coast is about a minute. The owner first chose 40 miles and halved it on seeing the first pictures. The size is one number in the recipe (`SCALE` in `terrain/make-island.mjs`): it moves where things are, and the mountains, glens and loch keep their real sizes, so a smaller island has fewer mountains, not steeper ones.

## The map

Laid out like Britain. North is up.

```
                  N
        .---------------------.
       /   ^    ^   ^    ^     \
      /  ^   [castle]      ^    \      HIGHLANDS
     |    ^   ~~loch~~   ^       |     peaks 6,000 to 8,000 ft
     |  ^    ^     ^    ^   ^    |
     |---------------------------|
     |                 # # # # # |
     |  moor, woods,   # air base|     FIELDS
     |  low hills      # RWY 10/28
     |  (room to grow) # # # # # |
      \                         /
       \___cove__arch__________/       JURASSIC COAST
                                       white cliffs
```

## The three places

**The highlands, in the north.** Scottish in shape and colour, but bigger than life: peaks of 6,000 to 8,000 feet with deep glens between them, so a valley run in a jet feels like something. Lochs lie in the glens.

**The castle school.** Inspired by and heavily influenced by Hogwarts: a millennial should know it at a glance. It stands on a crag above a loch, deep in the highlands and ringed by peaks. It is hidden: it can't be seen from the lowlands, and a pilot finds it by flying up a glen or over a ridge.

What makes it read at a glance, from the owner's reference model (a very detailed voxel castle he shared from his Drive; a guide to the idea, not something to copy or match in detail):

- A dense cluster of dark stone towers of different heights, each with a tall, steep, pointed roof. The skyline of spires is the whole recognition.
- One tower clearly the tallest, off-centre.
- A long great hall with a steep pitched roof and tall windows, against the cluster.
- A long covered bridge on tall legs, crossing a ravine to the castle.
- A glass-domed greenhouse and a small courtyard.
- Outlying pieces: a lone tower on its own rock, a boathouse down at the loch, a small hut on the slope below.

**The viaduct.** A long, curved stone railway viaduct on tall arches, across a glen near the castle: the giant bridge from the films. It stands on its own, and it is solid, so the arches are something to fly through. The steam train on it is saved for later, in the Ideas doc.

Ours is far simpler: plain shapes, dark grey stone and near-black roofs, a few thousand triangles. Get the skyline right and leave the rest out.

**The fields, in the east.** Flat East Anglian farmland: a patchwork of fields.

**The air base.** In the fields. Modelled on RAF Mildenhall: it doesn't have to be perfect, but a pilot should look at it and recognize Mildenhall. One runway, 10/28, 9,200 by 150 feet, with Mildenhall's layout of taxiways, ramp, hangars and tower. It is the only place to land when the island opens, and every flight starts on its runway.

**The Jurassic Coast, along the south.** White cliffs, with Lulworth Cove and Durdle Door.

**The west and the middle** are moor, woods and low hills for now. This is where the island grows.

## How it looks

Painted, to match the jet: clean colours for fields, moor, rock, cliff and sea, on flat-shaded land. Not photographic.

On the ground when it opens: the landmarks above, trees and woods, lochs and the sea. Villages and roads come later.

## What is solid

With crashes on (the crash override off):

- **Land** behaves as the runway does today: a hard hit ends the flight, a scrape survives.
- **Buildings and landmarks** are solid: the castle, the viaduct, the hangars and tower, the arch at Durdle Door. Flying through the arch is a real dare.
- **Woods** are solid at treetop height, as one block. Lone trees and hedgerow trees are scenery.
- **Water** ends the flight at any touch, however gentle: the sea and the lochs. To be revisited if an amphibious airplane joins the hangar.

With the crash override on, nothing ends a flight, as now.

## Not decided yet

- Names. The island, the base and the castle school have none, and nothing in the app shows one.
- Which parts are built in Blender, in a model chat, and which the app draws itself. That is for the milestone 4 plan.

## Where it is kept

The land's shape is `terrain/island.png`, a height map, with `terrain/island.json` beside it saying where it lies, where the loch is, and where each landmark stands. Both are written by `terrain/make-island.mjs`; to change the island, change that script and run it. `node terrain/preview.mjs <folder>` draws pictures of the result. `tests/island.test.js` checks the land against this page.

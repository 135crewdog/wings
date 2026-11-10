# Wings

A flight sim game for the iPhone: a home-screen web app at <https://135crewdog.github.io/wings/>. `CLAUDE.md` says what it is and the rules it's built under.

## Running the tests

You need Node 20 or later and nothing else: there are no dependencies to install.

```
npm test
```

The same command runs in GitHub Actions on every push and pull request.

It also flies the **checkride** (`tests/checkride.test.js`): the F-4C flown headless through maneuvers, printing what it did in knots, feet, degrees and g next to its card (`src/sim/cards/f4c.js`). To see just that:

```
node --test tests/checkride.test.js
```

## Running it locally

Any static file server works. From the repo's folder:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000/>.

## Versions

`APP_VERSION` in `src/version.js`, `VERSION` in `sw.js` and the newest entry in `CHANGELOG.md` change together on every deploy that changes what a player sees. The tests fail if they disagree. Every file the app needs is listed in `sw.js`, so it works offline.

## How the tools are connected

- **GitHub Actions** runs the tests on every push and pull request (`.github/workflows/test.yml`). On `main`, it publishes the site to GitHub Pages only if they pass (`.github/workflows/pages.yml`).
- **Codex** reviews every pull request when it opens. Claude Code fixes what it finds; the owner authorizes each merge.
- **Google Drive** holds the working files, in the `Wings` folder: `Reference` (photos and drawings), `Blender` (Blender files and exported models) and the `Ideas` doc. Google Drive for desktop syncs the folder to the owner's laptop.
  - Claude Code reaches it through the **Google Drive connector** and the **Google Docs connector** (read and edit the text of the Ideas doc).
  - The Drive connector only sees files Claude created through it: the folders and the Ideas doc. It cannot list or open files that arrive from the laptop, by search or by link (tested November 2026). So files from Blender reach Claude Code as chat attachments, not through the connector.
- **Blender** is driven only in chats in the owner's Wings Claude project, on his laptop, through the **Blender connector**. Claude Code never uses Blender.

### The path a model takes

1. A model chat builds the model in Blender, saves the `.blend` to `Wings/Blender/` and exports a `.glb` next to it.
2. The owner attaches the `.glb` from that folder to the Claude Code chat. Claude Code commits it to this repo, in `models/`.
3. The app loads it with Three.js's `GLTFLoader` (`vendor/three/examples/jsm/loaders/`).

A test cube made this trip in milestone 0 and drew in the app shell.

`docs/models.md` says what a model must be. `tests/model.test.js` checks `models/f4c.glb` against it, and checks that the airplane's card has its wheels where the model's are.

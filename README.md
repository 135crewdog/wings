# Wings

A flight sim game for the iPhone: a home-screen web app at <https://135crewdog.github.io/wings/>. `CLAUDE.md` says what it is and the rules it's built under.

## Running the tests

You need Node 20 or later and nothing else: there are no dependencies to install.

```
npm test
```

The same command runs in GitHub Actions on every push and pull request.

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
- **Codex** reviews every pull request.

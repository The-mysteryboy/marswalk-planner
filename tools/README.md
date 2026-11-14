# Tools

Everything here is for development. Nothing in this folder runs on the live site.

The browser scripts need `npm install` once. They use your installed Chrome, or set
`CHROME_PATH` to any Chromium browser.

## Building the data

| Script | What it does |
|---|---|
| `build_elevation.py <dem.tif> [--waypoints <file>]` | Builds both terrain grids and checks them against the rover |
| `build_map_data.mjs` | Rebuilds the rover track, mineral points and science stops |
| `build_underlay.py` | Rebuilds the local map image |
| `check_layers.mjs` | Tests every NASA tile layer. Also `npm run check-layers` |
| `build_rover_slopes.mjs` | Writes `data/rover_slopes.json` from NASA's full-resolution rover line |
| `release.mjs` | Stamps a release. Run as `npm run release` after any change |

## Finding scenario routes

`node tools/find_scenarios.mjs` searches with the real report engine and default assumptions: the
longest straight GO walk from the landing site, and the GO route near the most science stops. The
results are stored in `js/scenarios.js`, and `tests/scenarios.test.mjs` checks them.

## Checking the site

```bash
npm run verify
```

Runs `verify_site.mjs` against the live URL: page load, report grid, demo route, NO-GO link, the
plain sentence, the guided tour, leaving the data area, console errors, the app with cdnjs and with
trek.nasa.gov blocked, the message when the map library fails, Play the walk, the turn-back point, Reachable science, the rover path by slope, Clear and undo, the
More tools name and tip, Layers on the map, touch gestures in landscape, Science along this walk, stop
names, passing captions, the conditions feed (with a saved copy of its answer, never NASA's server),
About, map overlays at every size, touch and keyboard wording, the preset on a fresh load, base map switches, and the preview label. To check a local copy:

```bash
node tools/verify_site.mjs http://localhost:8000/
```

`check_deploy.mjs` simulates real deploys under a live service worker. It edits the folder it is
given, so always pass a throwaway copy of the site, never this folder.

```bash
node tools/check_deploy.mjs <throwaway-copy>
```

## Measuring speed

`measure_load.mjs` profiles page load at each connection speed, and `measure_report.mjs` prints the
tables. Add `--persist --aged 660` for a real return visit after the browser is closed. Add
`--block <pattern>` to block URLs from local software that would skew the numbers.

```bash
node tools/measure_load.mjs https://the-mysteryboy.github.io/marswalk-planner/ results.json --runs 3
```

```bash
node tools/measure_report.mjs results.json --detail
```

`measure_map.mjs` drives the real page through every map interaction at three speeds, and prints
one table. Add `--quick` to stop after the first view. `measure_touch.mjs` does finger panning and
pinch zoom on a phone-sized screen at 4x CPU slowdown.

```bash
node tools/measure_map.mjs https://the-mysteryboy.github.io/marswalk-planner/ map.json --runs 3
```

```bash
node tools/measure_map.mjs --table map.json
```

```bash
node tools/measure_touch.mjs https://the-mysteryboy.github.io/marswalk-planner/
```

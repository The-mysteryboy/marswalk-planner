# Marswalk Planner

**Check a Marswalk route against slope and time limits.**

Live: https://the-mysteryboy.github.io/marswalk-planner/

Marswalk Planner is a free web map of Jezero Crater on Mars, made for exploring how a crewed walk
there could be planned. It is intended for learning and mission-concept thinking, not real operations.
You place a base and draw a route, and it answers one question: does this walk stay within our assumed
slope and time limits? It layers imagery and elevation from Mars Reconnaissance Orbiter, Mars Global
Surveyor, Mars Express, Mars Odyssey and Perseverance, measures the route on a 40 m elevation grid
compared with 708 points on Perseverance's route (about 3 m typical difference, 3.1 m RMS), and gives
a GO, CAUTION or NO-GO with its reasons, the time out and back, a turn-back point and the science
stops along the way. The sources do not state how the rover elevations were produced, so this is a
comparison, not an independent measurement. It was built for the NASA Space Apps Challenge 2026,
"Interplanetary Survival Guide: Martian Map". It is a student project, not an official NASA tool,
not endorsed by NASA, and not for real mission planning.

**Data sources** (every value is traced in [SOURCES.md](SOURCES.md)):

- Map tiles from NASA Mars Trek: CTX and HiRISE (Mars Reconnaissance Orbiter), THEMIS (Mars
  Odyssey), MOLA (Mars Global Surveyor) and MOLA with HRSC (Mars Express).
- Elevation: the USGS CTX digital elevation model of Jezero Crater, averaged from 20 m to 40 m.
- Perseverance's traverse, positions and sample sites: NASA/JPL "Where is Perseverance?" map data.
- Hydrous mineral detections (OMEGA, CRISM) from NASA Mars Trek.
- Conditions: published MEDA (Perseverance) and RAD (Curiosity) measurements, and the latest reading
  from Curiosity's REMS outreach weather feed, which is from Gale Crater.
- Map library: Leaflet 1.9.4, shipped with the site.

**Run it:** open the live link, or serve this folder with `python -m http.server` and open
http://localhost:8000. Run the tests with `npm test`. Details are under "Run it locally" below.

**Licence:** the project's own code and text are under the Apache License 2.0 (see
[LICENSE](LICENSE) and [NOTICE](NOTICE)). Leaflet keeps its own BSD 2-Clause licence, and each
data source keeps its own terms, listed in [SOURCES.md](SOURCES.md).

**Known limits:** the slope limits, walking speed and time budget are this project's assumptions,
not NASA's. Slopes come from a 40 m grid, so short steep steps can be smoothed out. The walking
model is an Earth hiking model with no fatigue, suit mass or Mars-gravity effect. Conditions are
published snapshots and an outreach feed, not live and not science-grade. The full list is under
"Known limitations".

**Next steps:** live conditions, if an official Perseverance weather feed appears; lighting, meaning
sun angle and shadows along a route; and suit and oxygen models, built only from real published data.

## Try it

1. Open https://the-mysteryboy.github.io/marswalk-planner/
2. Press **Try the demo walk**.
3. Read the verdict and press **Why?**.
4. Press **Play the walk**.
5. Open **Example missions** and try **Check the nine stops**.

## Features

- **Layers from five missions:** Mars Reconnaissance Orbiter (CTX, HiRISE, CRISM), Mars Global
  Surveyor (MOLA), Mars Odyssey (THEMIS day and night), Mars Express (HRSC), and Mars 2020
  (Perseverance's real traverse).
- **Route drawing:** click to add waypoints, drag to edit, undo, clear. Keyboard works too: arrow
  keys move the map and Enter adds a waypoint at the crosshair.
- **Route report:** distance, elevation profile, max slope, steep sections, walking time out and
  back, abort distance, and a verdict that always lists its reasons.
- **Plain first view:** a **Start here** banner, one big **Try the demo walk** button and the
  verdict. A one-line key on the map names the base and science stop symbols, and a hint beside the
  mode buttons says what **Check a point** does. **Example missions** and **More tools: layers, slope
  map, safest route, stops** sit below, one click away. A line under the title says who it is for.
  Once a verdict appears, a one-time tip points to More tools. **Got it** dismisses it for good.
- **Layers on the map:** a **Layers** button at the top right of the map opens a small panel to
  switch the base map and overlays without scrolling away. Choosing a base map closes it, so the map
  shows. The layer cards and keys stay in More tools, and the two lists stay in step.
- **Base map switches:** the old map stays up until the new one has drawn, and the wait is always on
  show. After 3 seconds it says the app is still waiting for NASA's tile server. A switch needs one
  or two tiles of 50 to 60 KB from NASA's server, and that is where the time goes.
- **Phones on their side:** on a touch screen where the map fills most of the height, one finger
  scrolls the page and two fingers move the map. A short hint, "Use two fingers to move the map",
  appears when a one-finger swipe starts on the map, at most three times a visit. Taps, pinch zoom,
  marker drags, Check a point and Play the walk work as before. Upright phones and desktops keep
  one-finger dragging.
- **Guided tour:** **Take the 60-second tour** points at six controls in turn, with Next, Back and
  Skip. It works by keyboard and at phone width, Escape closes it, and it never blocks the page. The
  demo walk loads only if you press Next on step 1 with no route drawn, so it never replaces a route.
- **Plain-English summary:** one sentence above the numbers gives the distance, steepest slope and
  where, total time outside, time to spare and the verdict, from the same values the numbers show.
  It appears only once the 40 m report grid has loaded.
- **Play the walk:** once a route has its 40 m report, this replays it: a marker walks out from the
  base and back, with distance, elevation, slope, speed, steepest slope so far and time outside
  updating as the marker moves, a cursor on the elevation profile, and each steep section lit as the
  marker reaches it. Play and Pause, 1x, 4x and 16x, and Stop, with Escape to stop. At 1x, 4 minutes
  of the walk pass each second. Every number comes from the report, and the last frame is the report's
  totals. It never changes the route, verdict or share link. With reduced motion set, a slider steps
  through it.
- **Science along this walk:** under the verdict, a line says how many science stops lie within the
  stop search distance, 2 km by default, and a card lists them in the order the route passes them,
  each with its distance from the route, its sourced reason and a link. Zoomed in, the map names
  each stop, and tapping one shows its reason and source. Play the walk shows "Passing <stop>"
  once per stop as the walker first comes within range, or lists them as steps with reduced motion.
- **Conditions:** published measurements, each marked as measured at Jezero or at Gale, and the
  latest reading from Curiosity's REMS outreach weather feed with its age in days. The feed is
  fetched only when the panel opens and never affects a verdict. Perseverance's own feed ended in
  April 2024, so it is not used.
- **A tidy map on any screen:** one message shows at a time, and an open popup or Layers panel hides
  the messages, the key and the readout until it closes. On a narrow or touch screen a popup takes
  about 45% of the map at most, scrolls inside, has a 44 px close button, and stays clear of the
  mode switch, zoom buttons and Layers. Touch screens say Tap, and keyboards say Esc.
- **Ways out:** **Clear results** and **Clear rover colours**, or Escape inside either view, take
  their labels and colours off the map and put the map view back. Choosing a stop in the table shows
  **Restore my route**, and Clear also restores the route it replaced unless you have edited it.
- **Reachable science:** in Example missions, this checks all nine stops from your base under the
  active assumptions. Each gets the standard report on the straight route and, where slope rules
  that out, the safest-route search. SLOPE (a route exists under the slope limit) and TIME (the round
  trip fits the assumed time budget) stay separate. Choose a stop to load its route, and the map
  labels each stop by its result. It runs in the worker, on the 40 m grid only, and checks again when
  the base or an assumption changes. It uses our assumed slope limits and time budget, not NASA's
  rover or suit limits, and the safest route guarantees slope only.
- **Could a human walk where Perseverance drove?** Also in Example missions, this colours the rover's
  real path by the report's slope classes, with the share of the path in each, under the active
  limits. It is slope only, with no time or EVA rules, and uses our assumed limits, not NASA's rover
  or suit limits. Slopes are measured over the 40 m grid, so steeper local ground can be smoothed out.
  Under the Standard preset, measured in 50 m steps, 98.7% of the 46.75 km line (46.15 km) is at or
  under 15°, 1.3% (0.60 km) is over 15° up to 25°, and none is over 25°. The steepest step is 17.7°
  at 34.90 km along the path.
- **Turn-back point:** the report says whether the whole round trip fits the time budget. If it does
  not, **Turn back by here** marks the last point on the route where the time out, the time back and
  the science time still fit, on the map, the profile and in the report, with the numbers behind it.
  If even the first step does not fit, it says so. Play the walk then stops at that point, says why,
  pauses, and walks home, and its last frame gives both that walk and the report's totals.
- **Explain this:** **Why?** beside the verdict lists every rule the route passed or failed, and a
  **?** beside each number shows how it was worked out for this route: the inputs, the rule, the
  source, and which parts are assumptions. Everything uses the route's real computed values.
- **Check a point:** switch the map from **Draw a route** to **Check a point** and click any spot for its
  elevation, local slope, distance to the habitat, nearest science stop and what each active layer
  shows there. Clicks in this mode never add to the route. The app calls the habitat your base. It says Refining... until the 40 m grid
  has loaded.
- **Slope map:** a layer that colours every 40 m cell green, yellow or red, using the same limits
  as the report. It is drawn in the browser from the report grid, so it follows the limits under
  Assumptions and costs no extra download. A route can still cross red gently, along a contour,
  because each cell shows its steepest slope and the report measures along the route.
- **Example missions:** four ready-made walks, each with a preset route, short sourced captions to step
  through, and a goal checked by the real report. There are no points or scores: a goal is met or
  not met, with one line saying why, and it re-checks if you edit the route or the assumptions.
- **Assumption presets:** Cautious, Standard and Ambitious set the walking speed, EVA length and
  slope limits, then show the verdict for the same route side by side with the previous one.
  **Cautious and Ambitious are this project's own labeled assumptions, not NASA values or a NASA
  standard.** Standard is the defaults, and it applies on every page load and to every link that
  names no other preset. A fresh load always opens on Standard. Copy link carries a chosen preset,
  and the address bar only keeps one that came in on a link.
- **Find safest route:** searches the 40 m grid for the gentlest route from the habitat to your
  last waypoint, treating ground over the No-Go slope limit as a wall. The result is a normal
  editable route that gets the standard report, and if no safe route exists it says so. **Restore my
  route** brings back what you had.
- **Layer cards:** every layer has a **What am I looking at?** card with its mission, instrument,
  resolution, what it shows, why it matters for a Marswalk, a key and a source.
- **Site conditions:** cited measurements that say where and when they were taken.
- **Science stops:** nine named Perseverance sites, with the ones near your route listed.
- **Shareable links:** the route and layers live in the URL. **Copy link** copies it.
- **Survives a tile outage:** a small local image sits under the online map, and the elevation data
  is local, so reports still work if NASA's tile server is down.
- **Needs one outside host:** NASA Trek, for map tiles. Leaflet ships with the site, so the app loads
  and works with any other host blocked. The one other request goes to mars.nasa.gov when the
  conditions panel opens, and the panel still works without it. If the map library ever fails to load, the page says
  "The map couldn't load. Reload the page.".
- **Fast to open:** an 80 m preview grid lands first, so the map and route drawing respond at once.
  Repeat visits open from a cache. A preview never shows a verdict: only the 40 m report grid can.

## Run it locally

Any static server works, from this folder:

```bash
python -m http.server
```

Then open http://localhost:8000. Opening `index.html` directly from disk will not work, because
browsers block JavaScript modules on `file://`.

The page runs from the stamped copies in `app/`. After changing anything in `js/`, `css/`, `vendor/`, `data/`
or `index.src.html`, stamp a new release. The tests fail if you forget.

```bash
npm run release
```

The cache is off on `localhost`, so development always shows the latest files. To try it, open
http://127.0.0.1:8000 instead.

Run the tests (Node 20 or newer, no install needed):

```bash
npm test
```

## Deploy to GitHub Pages

Run `npm run release`, commit, and push to `main`, with Pages set to deploy from `main` at `/`.
Do not push while a Pages deployment is still running. Wait for it to report `built` first.

`npm run release` is the one build step. It is there so a deploy can never mix old and new files.
Every file the page names has a hash of its content in its name, and `index.html` names one exact
set of them, so a stale page gets an older complete set, never half of each. The previous version
stays published so a page cached before the deploy can still find its files.

`.gitattributes` marks the grids and images as binary, which matters: line-ending conversion would
corrupt them. `.nojekyll` tells Pages to serve the files as they are.

## Rebuild the data

Everything in `data/` is generated and already committed, so this is only needed to refresh it.

```bash
pip install rasterio numpy pyproj pillow
```

Elevation, from the 90 MB USGS DEM. Pass the rover waypoints to re-run the rover comparison:

```bash
python tools/build_elevation.py path/to/M20_JezeroCrater_CTXDEM_20m.tif --waypoints path/to/M20_waypoints.json
```

Rover traverse, mineral detections and science stops:

```bash
node tools/build_map_data.mjs
```

Local fallback image:

```bash
python tools/build_underlay.py
```

Then stamp the result, as above, with `npm run release`.

Re-test every map layer:

```bash
npm run check-layers
```

## How the numbers were checked

- **Elevation:** the report grid is 40 m, averaged from the 20 m CTX DEM. It was compared with 708
  points on Perseverance's route (about 3 m typical difference, 3.1 m RMS); before rounding, 3.08 m
  RMS with a mean difference of -0.84 m. The sources do not state how the rover elevations were
  produced, so this is a comparison, not an independent measurement. The comparison runs as a unit
  test through the same code the browser uses.
- **Lossless storage:** the grid is stored as differences between neighbouring cells, which halves
  the download. The decoded grid has the same SHA-256 as the original, and the browser checks that
  hash before using it.
- **Distance:** a route was re-measured with a different formula in Python: 10.791 km against the
  app's 10.79 km.
- **Full report:** a 12.99 km route was reproduced by separate Python code reading the raw grid.
  Distance, max slope and its position, both walking times, EVA total, abort distance and climb all
  matched.
- **Unit tests:** 294 tests using hand-computed values, including the exact verdict boundaries and
  the validated results for the demo and scarp routes.
- **Map scale:** Leaflet's built-in distance assumes Earth, which would make the scale bar 1.9 times
  too long. The app swaps in the Mars radius, and 1 degree of latitude reads 59,157.9 m.
- **Outage:** the app was run against a dead tile server, and it still shows imagery and full reports.

## Assumptions

The verdict line calls these "our assumed limit". **Why?** gives the exact wording, marked
(assumption), with the full explanation.

These are placeholders chosen for this tool. None is a NASA requirement. All are labeled in the app
and can be edited under **Assumptions**.

| Assumption | Default |
|---|---|
| Walking speed on flat ground | 3.5 km/h |
| Effect of slope on speed | Tobler hiking function, rescaled to the speed above |
| EVA duration available | 8 hours (placeholder, not a NASA spec) |
| Science time | 60 minutes |
| No-Go | Slope over 25°, over the EVA budget, or leaving elevation coverage |
| Caution | Slope over 15°, or under 25% budget margin |
| Stop search distance | 2 km |
| Route sampling | Every 50 m |

## Decisions

- **The safest route is A* over slope-map cells.** Cells over the No-Go limit are walls, and each
  metre costs 1 + (slope / caution limit) squared. That cost is an ASSUMPTION for choosing between
  safe routes, and it is never shown as a score. Because every line stays on allowed cells, the rule
  below means no step can fail the slope check, at any sample spacing. It is a guarantee about slope
  only: a long detour can still be No-Go on the EVA budget, and the report will say so.

- **The slope map shows the steepest slope in each cell, and the report measures along the route.**
  A cell has one colour, but a route can cross it in any direction, so they cannot be the same
  number. The cell value is the steepest gradient anywhere on the same bilinear surface the report
  samples, which gives an exact one-way rule: no route step can be steeper than the steepest cell it
  crosses. A route that fails a slope check always crosses a cell of that colour, and a route that
  stays on green can never fail one. A route can still cross a red cell gently, along the contour.
  `tests/slope.test.mjs` checks this on the validated routes and on 500 random routes, across
  several sample steps and limits. No colour means no elevation data, and any route there is No-Go.

- **Tiles come from `trek.nasa.gov`, not `api.nasa.gov`.** The `api.nasa.gov` route mostly timed out
  or returned 404 in testing. Trek worked for every tile layer with no API key.
- **The return walk uses the real reversed slopes** rather than doubling the outbound time. On flat
  ground the result is the same. Doubling would understate a route that descends and must climb back
  out, which is the unsafe direction to be wrong in.
- **The route always starts at the habitat.** Moving the habitat moves the start of the route.
- **The report grid is 40 m, averaged from the 20 m CTX DEM.** It keeps the data small, matches the
  50 m route sampling, and is the grid the 3.08 m RMS was measured on.
- **The map fetches ahead while idle.** NASA's tile server takes a second or two per tile, so tiles
  are fetched before they are needed: the ring around the view, the next zoom level out, and the
  small low-resolution layers. This uses some extra data, so it is off on data-saver and slow
  connections, and it stops whenever the map moves or a visible layer needs tiles.
- **During a drag, only the line and distance update.** The report dims so its verdict never reads
  as current, then the normal report runs on release, so the result is exactly the same.
- **A preview never shows a verdict.** The 80 m preview grid smooths away short steep slopes. On the
  scarp route it reads 22.1° where the report grid reads 26.7°, which would turn a No-Go into a
  Caution. So until the report grid arrives the panel says "Refining...", and if it never arrives
  the panel says "No verdict".
- **CRISM appears as detection points, not a map.** No CRISM raster covering Jezero was found in the
  Trek equirectangular catalog.
- **Rover and mineral data are local copies.** The rover feed is not a documented public API, so the
  app must not depend on it at runtime.
- **No science value score.** No transparent ranking was defined, so stops are sorted by distance.

## Known limitations

- **A Go is not proof the ground is walkable.** Slopes are averaged over about 50 m, so short steep
  steps, boulders and small craters do not show. The source DEM cannot resolve them either.
- **The walking model is an Earth hiking model.** It was fitted to people on Earth, not suited
  astronauts in Mars gravity. Speed changes only with slope. The model has no fatigue, suit mass or
  Mars-gravity effect on walking speed, so it walks at the same pace in hour 20 as in hour 1. The
  turn-back point inherits all of this, so it is a planning estimate from an assumed time budget,
  not a safety limit. The app holds no oxygen, power or fatigue values.
- **No model of** suit limits, loose ground, lighting, dust storms, or the terrain between two
  points beyond the sampled line.
- **Reachable is not a claim about real access.** Under Standard every stop has a straight route
  under the limits, but those limits are ours, the slopes come from a 40 m grid, and a straight line
  on this grid says nothing about boulders or loose ground. The search treats a whole cell as
  closed if its steepest gradient is over the limit, so a stop in such a cell reads as not reachable
  even where a walker might get round the steep part inside the cell.
- **The rover path figures depend on the step length.** They use 50 m steps along NASA's recorded line,
  the report's sampling interval. Measured point to point, about 1 m apart, the same line reads
  30.4° at its steepest and 0.01% of it over 25°, because a 1 m step on a 40 m grid mostly shows
  which way that metre happened to head. The recorded line is 46.75 km long, against 45.25 km of
  rover odometry, because small position corrections add length.
- **The slope map is not a route verdict.** It uses the same limits as the report, but a cell shows
  its steepest slope, so a route crossing red gently along a contour can still pass. A route that
  stays on green cannot fail a slope check. The map shows slope only, not time or data coverage.
- **The safest route only guarantees slope.** A long detour can still be No-Go on the EVA budget.
- **Conditions are snapshots.** Weather is from early in the mission, and radiation was measured at
  Gale Crater, not Jezero.
- **Stops mark areas, not outcrops.** They use the rover's last recorded position before each sample
  was sealed.
- **Elevation coverage is about 60 km across.** Anything outside the dashed box is a No-Go.
- **Waypoints can be added by keyboard, but dragging one needs a mouse or touch.**
- **On a slow connection, a new deploy can take one extra visit to appear.** The saved page opens
  rather than waiting. It is a complete older version, and the new one is ready next time.
- **Distances use a sphere of 3389.5 km.** The DEM's own CRS uses 3396.19 km, a difference of about
  0.2%.
- **Tested in Chromium only**, at desktop and phone widths. The slope map and safest route need a
  browser with module workers and OffscreenCanvas. Without them the app says so, and the rest works.
- **First view is heavy on a slow device.** At 4x CPU throttling, the main thread blocks for far
  longer than 50 ms on first view, as it did before the newer features. Most of this is browser
  layout and paint work.

## Demo script

1. Open the live link. Toggle **THEMIS night infrared** and **MOLA elevation** to show the layers,
   then return to CTX.
2. Press **Try the demo walk**. It loads a CAUTION: the route passes three sample sites, then crosses an
   18° slope, shown in yellow on the map and the profile.
3. Point out the reason and the numbers, then press **Why?**. Open **More tools** for the seven stops.
4. Hover the profile, and a marker follows along the route on the map.
5. Drag waypoint 4 up onto the delta, north-west, to find a safer line. The verdict flips to GO.
6. For a No-Go: press **Try the demo walk** again, then click just north-west of waypoint 4, up the dark scarp
   at about 18.473 N, 77.421 E. The slope reaches 26.7° and shows in red.
7. In **More tools**, open **Assumptions** and change the EVA duration to show the verdict respond.
8. Press **Copy link** and open it in a new tab to show the plan restored.

If there is time for the newer features:

- On the No-Go route, press **Why?** to show every rule it passed or failed, then open **More tools**
  and press **Find safest route** to turn it into a Caution at 21.1°.
- Turn on **Slope map**, switch the map to **Check a point**, and click the scarp to read that spot.
- Open **Example missions** and step through **The scarp that turns a route NO-GO**.

## Project layout

```
css/style.css           Dark theme and layout
js/main.js              Map setup, layers and UI wiring
js/layers.js            One config object per layer, with mission and source
js/route.js             Distance, interpolation, sampling
js/terrain.js           Elevation grid sampling and slope
js/report.js            Time, abort distance, verdict
js/explain.js           Plain-English explanations of the report
js/inspect.js           What the app can say about one map point
js/slope.js             Steepest slope of each grid cell
js/slope_worker.js      Draws the slope map away from the page
js/scenarios.js         Mission scenarios and their goals
js/presets.js           Assumption presets
js/pathfind.js          Safest route search
js/tour.js              Guided tour
js/walk.js              Play the walk
js/reach.js             Reachable science
js/roverpath.js         The rover path by slope
js/chart.js             Elevation profile
js/conditions.js        Cited conditions table
js/hash.js              Shareable links
js/assets.js            Written by the release: published file names
index.src.html          The page template
index.html              Written by the release
vendor/leaflet/         Leaflet 1.9.4 and its license, unchanged
app/                    Written by the release: versioned copies of js/, css/, vendor/ and data/
sw.js                   Repeat-visit cache
data/                   Generated data, see "Rebuild the data"
tools/                  Scripts that build, stamp and check everything
tests/                  Unit tests, and a browser terrain check page
SOURCES.md              Every data point, with its URL and how it was checked
```

Every source is listed in [SOURCES.md](SOURCES.md).

## Licence

Copyright 2026 the-mysteryboy. The project's own code, tests, scripts and documentation are
licensed under the Apache License, Version 2.0: see [LICENSE](LICENSE) and [NOTICE](NOTICE).

Third-party parts keep their own terms:

- Leaflet 1.9.4, in `vendor/leaflet/` and each `app/<version>/leaflet/`: BSD 2-Clause, see
  `vendor/leaflet/LICENSE`.
- Map tiles, elevation, rover positions, mineral detections and conditions: each source's own terms
  and credit line, listed in [SOURCES.md](SOURCES.md). The Apache licence does not cover them.

## AI assistance

Marswalk Planner was conceived, directed and decided by its author and built with AI coding
assistance (Claude, via Claude Code). See [AI-DISCLOSURE.md](AI-DISCLOSURE.md) for who did what. The
app and its tests are open source under Apache-2.0.

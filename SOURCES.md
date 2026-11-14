# Sources

Every data point used by Marswalk Planner, with where it came from and how it was checked.

## 1. Map tile layers (NASA Trek WMTS)

Tile host: `https://trek.nasa.gov/tiles/Mars/EQ/{product}/1.0.0/{Style}/{TileMatrixSet}/{z}/{row}/{col}.{ext}`

Catalog query used to find these products (the docs page builds its list from this):
`https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?start=0&rows=2147483647&facetKeys=itemType&facetValues=product`

Results from `node tools/check_layers.mjs` (raw output: `tools/layer_check_results.json`).
Every layer below uses Style `default`, TileMatrixSet `default028mm`, 256 px tiles, and a grid
that matches Leaflet `L.CRS.EPSG4326` exactly (z0 = 2 cols x 1 row, top-left -180, 90).

| Layer | Mission | Instrument | Product | Ext | Max z | Coverage (W, S, E, N) | Test | Used? |
|---|---|---|---|---|---|---|---|---|
| CTX imagery, wide | Mars Reconnaissance Orbiter | CTX | `Jezero_CTX_BlockAdj_dd` | png | 12 | 75.154, 15.906, 78.872, 19.445 | WORKS | Yes |
| CTX imagery, controlled 6 m | Mars Reconnaissance Orbiter | CTX | `JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0` | png | 13 | 77.160, 18.211, 77.699, 18.721 | WORKS | Yes |
| HiRISE imagery, controlled 25 cm | Mars Reconnaissance Orbiter | HiRISE | `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd` | png | 17 | 77.223, 18.307, 77.584, 18.669 | WORKS | Yes |
| MOLA colour hillshade 463 m | Mars Global Surveyor | MOLA | `Mars_MGS_MOLA_ClrShade_merge_global_463m` | jpg | 7 | global | WORKS | Yes |
| MOLA + HRSC colour hillshade 200 m | MGS + Mars Express | MOLA + HRSC | `Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw` | jpg | 8 | global | WORKS | Yes |
| THEMIS IR Day 100 m | Mars Odyssey | THEMIS | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` | png | 9 | global to 65 deg | WORKS | Yes |
| THEMIS IR Night 100 m | Mars Odyssey | THEMIS | `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` | png | 9 | global to 65 deg | WORKS | Yes |
| THEMIS IR Day v12 | Mars Odyssey | THEMIS | `Mars_MO_THEMIS-IR-Day_mosaic_global_100m_v12_clon0_ly` | png | 8 | global to 65 deg | WORKS | No, the v2 controlled mosaic above is better |
| Mosaic, Jezero NE Syrtis Midway | MRO | HiRISE/CTX/HRSC | `NES_JEZ_MID_Visible_Mosaic_HiRISE_CTX_HRSC_GCS_MARS_07-10-2018` | png | 17 | 76.791, 17.579, 77.731, 18.693 | WORKS | No, redundant |
| Viking colour | Viking | MDIM 2.1 | `Mars_Viking_MDIM21_ClrMosaic_global_232m` | jpg | 7 | global | WORKS | No, not needed |
| TES thermal inertia | Mars Global Surveyor | TES | `TES_Thermal_Inertia` | png | 1 | global | WORKS, too coarse (z1) | No |
| MOLA roughness | Mars Global Surveyor | MOLA | `mola_roughness` | png | 1 | global | WORKS, too coarse (z1) | No |
| Perseverance traverse (tiles) | Mars 2020 | - | `Perseverance_Traverse_Path` | png | 18 | 77.304, 18.427, 77.463, 18.500 | FAILS on the tile host (404); capabilities point to an ArcGIS service | No, NASA GeoJSON used instead (section 3) |
| Hydrous minerals (tiles) | MRO + Mars Express | CRISM + OMEGA | `Hydrous_Mineral_Detections_CRISM_clon0` | - | - | global | FAILS as WMTS (404); it is a feature layer | Points used instead (section 4) |

Rechecked 2026-11-14 against each layer's `WMTSCapabilities.xml`, with tile requests one level past the
top: CTX stops at zoom 12 (z13 is 404), MOLA + HRSC at zoom 8 (z9 is 404), MOLA at zoom 7 (z8 is 404). All
three use 256 px tiles, and MOLA and MOLA + HRSC offer JPEG only. `maxNativeZoom` matches in every case.

Spot checks by eye: the CTX z11 tile at the landing site and the MOLA z7 tile both show real
cratered terrain, not a blank or error image.

### Corrections to the original brief

- **Use `trek.nasa.gov`, not `api.nasa.gov`.** `api.nasa.gov/mars-wmts` timed out at 30 s or
  returned 404 for most requests across two runs, without a key, including for the layers the
  brief quoted. `trek.nasa.gov` returned 200 for all real tile layers, with no key.
- The brief's `.jpg` THEMIS example returned an image from `api.nasa.gov` once, but it is a 404
  on `trek.nasa.gov`, whose capabilities list that layer as `.png`.
- **The 718 Pa pressure is not from sols 43-44.** The JPL article gives it with MEDA's first data
  points. The sols 43-44 report covers temperature and wind. The app labels them separately.
- **No CRISM raster covers Jezero in the Trek equirectangular catalog.** Searching 225 products
  for "crism" found only the two rasters at other locations (`T1303_FeMgSmectite...`,
  `MC18_PolySulfate...`) and the hydrous detections point layer. The "CRISM I/F 1330 nm" layer
  mentioned in the brief was not found in this catalog.

### API key

**None needed.** All `trek.nasa.gov` requests above were keyless.

### Browser and hosting checks

- Every tile response carries `Access-Control-Allow-Origin: *`.
- 24 parallel tile requests with a `github.io` Referer/Origin: 24/24 OK, twice (`median 710-1767 ms`).
- Missing tile: HTTP 404 (`text/html`). The app treats this as "no coverage here", not an error.

## 2. Elevation

| Item | Value |
|---|---|
| Dataset | Mars 2020 Science Investigation CTX DEM Mosaic |
| Product page | https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic |
| File | https://planetarymaps.usgs.gov/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif |
| Size | 90,345,300 bytes |
| Grid | 4456 x 5067, float32, 20 m/pixel |
| CRS (read from the file) | Equirectangular, `standard_parallel_1 = 18.4663`, `central_meridian = 0`, sphere radius 3396190 m |
| Nodata (read from the file) | -3.4028e+38 |
| Report grid | 1546 x 1482 cells, 40 m, averaged from the 20 m DEM, 77.02 to 78.12 E and 17.96 to 18.96 N |
| Preview grid | 773 x 741 cells, 80 m, averaged from the report grid over the same area. Never used for a verdict. |
| Storage | Lossless. Differences between neighbouring cells, 4.58 MB raw and 1.87 MB gzipped for the report grid. SHA-256 of the decoded report grid: `0391d9c111d53b4f971c379fff1b4e0e0f9fa54463297a4d4d3de9ad7191cec4` |

Compared with 708 points on Perseverance's route (about 3 m typical difference, 3.1 m RMS): all 708
rover waypoints, report grid minus `elev_geoid`, by `tools/build_elevation.py` and on every test run
by `tests/accuracy.test.mjs`: mean -0.84 m, standard deviation 2.97 m, RMS 3.08 m, worst 12.36 m. The
rim stands 778.3 m above the landing site in the DEM and 783.9 m in the rover feed's `elev_geoid`. The
two datasets share a vertical reference closely enough that no offset was needed. The sources do not
state how the rover elevations were produced, so this is a comparison, not an independent measurement.

## 3. Perseverance positions

| Item | Value |
|---|---|
| Waypoints | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json |
| Traverse | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json |
| Content | 708 waypoints, sol 13 to sol 2022, 45.25 km driven, with `elev_geoid` from rover localization |
| Publisher | NASA/JPL "Where is Perseverance?" map data. Not a documented public API, so the app ships a local copy. |

The map draws the traverse thinned to one point per 10 m. It is display only, and no report uses it.

Check: the feed's `easting`/`northing` equal the DEM projection applied to its `lon`/`lat` to
within 1 mm for all 708 waypoints, so the two datasets share a CRS.

## 4. Mineral detections

| Item | Value |
|---|---|
| Dataset | Hydrous Mineral Detections (OMEGA, CRISM), NASA Mars Trek |
| Feature service | https://trek.nasa.gov/mars/trekarcgis/rest/services/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0 |
| Query box | 75 to 80 E, 16 to 21 N |
| Result | 11 points (10 CRISM, 1 OMEGA). This is a coarse detection catalog, not a mineral map. |

## 5. Location and constants

| Fact | Value | Source |
|---|---|---|
| Mars volumetric mean radius | 3389.5 km | NASA NSSDC Mars Fact Sheet, https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html |
| Jezero crater center | 18.4082 N, 77.6873 E | IAU/USGS nomenclature via the Mars Trek index (`itemType:nomenclature`, feature "Jezero") |
| First Perseverance waypoint (sol 13, site 3) | 18.44462715 N, 77.45088572 E | `M20_waypoints.json` |

## 6. Conditions

All are in `js/conditions.js`. They are one snapshot from each source, not a forecast.

| Value | Where and when | Instrument | Source |
|---|---|---|---|
| High about -22 C, low about -83 C | Jezero, sols 43-44 (Apr 3-4, 2021) | MEDA, Perseverance | https://www.jpl.nasa.gov/news/nasas-first-weather-report-from-jezero-crater-on-mars/ |
| Wind gusts about 10 m/s | Jezero, sols 43-44 (Apr 3-4, 2021) | MEDA, Perseverance | Same |
| Pressure 718 Pa, models predicted 705-735 Pa | Jezero, MEDA's first data points, 2021 | MEDA, Perseverance | Same |
| Optical depth about 0.5 morning, 0.4 afternoon | Jezero, first 250 sols, clear season | MEDA SkyCam, Perseverance | Rodriguez-Manfredi et al. (2023), Nature Geoscience 16, https://www.nature.com/articles/s41561-022-01084-0 |
| Radiation 0.67 mSv/day | **Gale Crater**, Aug 2012 to Jun 2013, no major solar storms | RAD, Curiosity | https://www.jpl.nasa.gov/news/nasa-curiosity-first-mars-age-measurement-and-human-exploration-help/ |

### Latest reading from a weather feed

Tested 2026-11-14 from the shell, sending this site's address as the origin:

| Feed | Result |
| --- | --- |
| https://mars.nasa.gov/rss/api/?feed=weather&category=mars2020&feedtype=json | HTTP 200, CORS open. 7 entries, the newest sol 1133 (2024-04-27), 931 days old, with "--" for missing values. Not used |
| https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json | HTTP 200, CORS open, 1.7 MB (120 KB compressed). 4,745 entries, the newest sol 4995, 81 days old. 28 entries use "--". Used |

The Curiosity feed's own disclaimer says it is from Centro de Astrobiología, for outreach only, and
points to PDS for REMS science data. `latestReading` in `js/conditions.js` takes its newest entry,
and shows nothing unless the sol, the date and three values are all real numbers in range: air -140
to 40 °C with the low no higher than the high, and pressure 300 to 1300 Pa. The page fetches it only
when the conditions panel opens, gives up after 3 s, tries once more, and keeps a good reading for
6 hours. It is labelled "Outreach-grade feed, not science-grade, not live. Curiosity's weather is
from Gale Crater, not Jezero." It never feeds any verdict or any number in the report.

Perseverance's science data reaches the public archive in batches. The newest, Mars 2020 Release 16,
covers sols 1740 to 1859 (January 10 to May 13, 2026) per
https://pds-geosciences.wustl.edu/missions/mars2020/ and https://pds.nasa.gov/datasearch/subscription-service/SS-Release.shtml.
The MEDA archive at https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/ ends at the same
folder, `sol_1740_1859`.

## 7. Science stops

Stop coordinates are never typed by hand. `tools/build_map_data.mjs` reads each one from NASA's
feeds, using the rover's last fix on or before the sol the sample was sealed. Sols come from
https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/

| Stop | Sol used | Why it matters comes from |
|---|---|---|
| Octavia E. Butler Landing | 13 | https://www.jpl.nasa.gov/news/nasas-perseverance-drives-on-mars-terrain-for-first-time/ |
| Wright Brothers Field | Ingenuity flight 1, from `m20_heli_waypoints.json` | https://www.jpl.nasa.gov/news/nasas-ingenuity-mars-helicopter-succeeds-in-historic-first-flight/ |
| Rochette (Citadelle) | 194 | https://www.jpl.nasa.gov/images/pia24750-perseverances-journey-to-first-successful-sample-collection/ |
| Brac (Seitah) | 262 | https://science.nasa.gov/missions/mars-2020-perseverance/to-seitah-and-back |
| Skinner Ridge | 490 | https://www.nasa.gov/news-release/nasas-perseverance-rover-investigates-geologically-rich-mars-terrain/ |
| Wildcat Ridge | 509 | Same as Skinner Ridge |
| Three Forks Sample Depot | 653 | https://science.nasa.gov/resource/a-map-of-perseverances-samples/ and https://ntrs.nasa.gov/api/citations/20230000371/downloads/Herd_M2020_LPSC23_RSS_overview_final.pdf |
| Comet Geyser (Bunsen Peak) | 1088 | https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/ |
| Cheyava Falls (Bright Angel) | 1215 | https://www.jpl.nasa.gov/news/nasa-says-mars-rover-discovered-potential-biosignature-last-year/ |

No "science value" score is shown, because no transparent way to rank these was defined.

## 8. Walking model

Tobler's hiking function, W = 6 exp(-3.5 |S + 0.05|), rescaled so flat ground equals the chosen
base speed. Source: Tobler, W. (1993), Three Presentations on Geographical Analysis and Modeling,
NCGIA Technical Report 93-1, https://escholarship.org/content/qt05r820mz/qt05r820mz.pdf

It was fitted to people hiking on Earth. It is an ASSUMPTION here, not a NASA EVA model.

## 9. Map fallback image

`data/jezero_underlay.webp` is stitched by `tools/build_underlay.py` from NASA Trek layer
`Jezero_CTX_BlockAdj_dd`, zoom 9, then reduced to about 122 m/pixel and 146 KB.

## 10. Explanations

The Explain panel, the Why? list and Check a point are built by `js/explain.js` and `js/inspect.js`. They
repeat values from `measureRoute` and the settings, and `tests/explain.test.mjs` checks that they
match. Their fixed sentences trace to these places:

| Sentence | Traces to |
|---|---|
| Distance rule, Mars mean radius 3389.5 km | `js/route.js`, section 5 |
| Slope rule, atan(rise / run), sampled along the route | `js/report.js`, `js/terrain.js` |
| "Compared with 708 points on Perseverance's route (about 3 m typical difference, 3.1 m RMS): RMS difference 3.084 m, mean difference -0.836 m. This is a comparison, not an independent measurement." | section 2, recomputed by `tests/accuracy.test.mjs` |
| Anything under 40 m is not in the elevation data | The grid's cell size, section 2 |
| Walking time, return leg and EVA rules | `js/report.js`, section 8 |
| "Tobler fitted this model to people hiking on Earth." | Section 8 |
| "Slow and risky" in Check a point | The CAUTION limit, an ASSUMPTION, with the speed from the walking model in `js/report.js` |
| Every limit marked (assumption) | `DEFAULT_SETTINGS` in `js/report.js`, listed under Assumptions in the README |
| The sentence above the numbers, "This walk of ... each way gets a ..." | `routeSentence` in `js/report.js`, from the same `measureRoute` values and settings as the numbers. `tests/sentence.test.mjs` checks the demo (CAUTION, 18.1° at 4.44 km) and the NO-GO link (26.7° at 5.13 km). It stays empty until the 40 m report grid has loaded |
| "our assumed limit", "our assumed caution limit", "our assumed time limit", "our assumed reserve" | The settings above. All are ASSUMPTIONS, not NASA values |
| "Check a walk is safe before an astronaut leaves base." | The project's own statement of purpose. It contains no data. This is a student tool, not for real mission planning |
| Tour captions in `js/tour.js` | They describe the app and state no measured value. "The rover's landing site" is the demo's base, the `oeb` stop in section 7 |

### Science along this walk

The card, the line in the verdict and the captions in Play the walk add no data. They list the
stops `stopsNearRoute` in `js/report.js` already finds within the stop search distance, 2 km by
default, with each stop's sourced reason from section 7. The card orders them by where the route
passes nearest. A caption appears where the walk out first comes within that distance.

### Buttons and hints from the phone usability pass

These are labels and instructions only. None states a measured value.

| On screen | What it does |
| --- | --- |
| More tools: layers, slope map, safest route, stops | Opens the More tools section, unchanged inside |
| Map layers, the slope map, the safest route and nearby stops are in More tools, further down. | A one-time tip after the first verdict. Got it hides it for good |
| Layers | The panel on the map. Same layers and switches as the cards in More tools |
| Clear results, Clear rover colours | Take the science views off the map and put the map view back |
| Restore my route | Puts back the route that a stop from the Reachable science table replaced |
| Use two fingers to move the map | Shown on a touch screen where the map fills most of the height |
| Loading NASA tiles... | Shown while a chosen base map loads |
| Still waiting for NASA's tile server. Your map stays up until the new one arrives. | Replaces that after 3 seconds. It cannot tell a slow server from a slow connection, so it says neither is at fault |
| Tap the map to read elevation and slope at that spot. | Check a point's first message. A mouse and keyboard reads Click |
| Nothing is added to your route. Tap Draw a route to go back. | Replaces that message. A mouse and keyboard reads Press Esc to go back to drawing |

## 11. Layer cards

The cards in `js/layers.js` reuse the wording of NASA Trek's own product descriptions, read from the
catalog query in section 1. Resolutions are from section 1.

| Layer | Card statement | Trek description or other source |
|---|---|---|
| CTX | "Wide view around the narrower HiRISE images" | `Jezero_CTX_BlockAdj_dd`: "provides broader context maps for the higher resolution but narrower fields of view of the HiRISE camera" |
| CTX | Elevation model made from CTX stereo images | `JEZ_ctx_B_soc_008...`: "digital terrain models (DTMs) created from CTX stereo images", and section 2 |
| CTX controlled | The map the landing system carried | `JEZ_ctx_B_soc_008...`: the Lander Vision System map used by Terrain Relative Navigation |
| HiRISE | NASA mapped surface hazards on this mosaic | `JEZ_hirise_soc_006...`: "the basemap onto which surface hazards were mapped" |
| HiRISE | 160 times finer than the slope grid | 40 m / 0.25 m |
| MOLA | Timed laser pulses, more than 600 million measurements, 1999 to 2001 | `Mars_MGS_MOLA_ClrShade_merge_global_463m` |
| MOLA + HRSC | Blend of terrain models from both instruments | `Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw` |
| MOLA, MOLA + HRSC | A hillshade makes the shape of the land easy to see | `Mars_MGS_MOLA_ClrShade_merge_global_463m`: "makes it particularly easy to visualize surface topography" |
| THEMIS day | Warmer sunward slopes are brighter, emphasizes topography | `THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018` |
| THEMIS night | Thermal inertia differences, insight into physical characteristics | `THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018` |
| Mineral detections | Clays and hydrated salts, a record of early environments altered by liquid water | `Hydrous_Mineral_Detections_CRISM_clon0` |
| Traverse | 708 waypoints were compared with the elevation grid | Sections 2 and 3 |
| Science stops | Position is the rover's last fix before sealing | Section 7 |

Nowhere does the app read a value from a tile image. Check a point says what a tile layer shows and whether
it covers the point. Trek publishes no colour scale for the two hillshades in these records, so the
cards give none and point to Check a point for real heights.

## 12. Slope map

Computed in the browser from the 40 m report grid in section 2, in a worker, by `js/slope.js`. No
file is added and no data is invented. Colours use the limits under Assumptions, which are
ASSUMPTIONS, and the same comparison as the report: exactly at a limit passes.

Colours use the same limits as the report, but the two measure different things. Each cell shows the
steepest gradient anywhere inside it, while the report measures along the route, between samples. So
a route can cross a red cell gently, along a contour, and still pass. The rule that holds is one-way:
no route step is steeper than the steepest cell it crosses, so a route that fails a slope check always
crosses a cell of that colour, and a route on green alone cannot fail one. `tests/slope.test.mjs`
checks this on the validated routes and on 500 random routes.

The colours are the app's Go, Caution and No-Go colours: `#46d39a`, `#ffec80`, `#f0386b`. The
dataviz validator on the dark surface `#12100e` gives colour-blind separation of 12.8 (protan, the
worst pair), normal-vision separation of 21.6, and contrast of at least 3:1. Its lightness-band check
fails, and that is deliberate: moving these colours into that band dropped colour-blind separation
below 5, because their separation comes from their differences in lightness.

Small No-Go text uses a slightly lighter red, `#f44876`, because `#f0386b` is 4.2:1 on the panel. The
lighter red reaches 4.58:1 on the panel and 5.08:1 on the sidebar. It is used for text only, so the
map, the verdict icon and the chart keep `#f0386b`. If it were used in the set above, colour-blind
separation would be 10.6, still over the target of 8.

## 13. Example missions

Example missions are in `js/scenarios.js`. Routes marked as found come from `tools/find_scenarios.mjs`, and
`tests/scenarios.test.mjs` checks each goal against the real report. Captions marked "report" are
built from the report for the route on the map, so they hold no stored numbers.

| Mission | Caption | Source |
|---|---|---|
| Landing site to the delta front | Octavia E. Butler Landing | Section 7 |
| | Three Forks Sample Depot | Section 7 |
| | Wildcat Ridge | Section 7 |
| | Route length, verdict, steepest step | Report |
| The scarp that turns a route NO-GO | Perseverance went to investigate an ancient delta | NASA Trek description of `JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd`: "to investigate an ancient delta for evidence of past microbial life" |
| | Verdict without the last waypoint | Report |
| | Slope at the scarp and the limit | Report. The limit is an ASSUMPTION |
| The longest straight walk that stays GO | EVA budget, science time, reserve | The settings, all ASSUMPTIONS |
| | Farthest GO walk, every 5° to the nearest 50 m | `tools/find_scenarios.mjs`, with default assumptions |
| | Length, time used, steepest step | Report |
| Every science stop on one GO route | Cheyava Falls | Section 7 |
| | Comet Geyser | Section 7 |
| | Stops within the search distance, farthest stop | Report. The distance is an ASSUMPTION |

The one-line descriptions in the mission list hold no numbers. Each restates its mission's captions
above, and "ancient delta" is from the same Trek description.

The longest-walk route is a claim about straight lines from the landing site only. A bent route could
go farther. The stops route passes near the stops, within the 2 km search distance, and does not
visit them.

## 14. Assumption presets

In `js/presets.js`. **Nothing in this section is a NASA value.** All of it is an ASSUMPTION.

| Setting | Cautious | Standard | Ambitious |
|---|---|---|---|
| Walking speed on flat ground | 3 km/h | 3.5 km/h | 4 km/h |
| EVA length | 6 h | 8 h | 10 h |
| Caution slope limit | 10° | 15° | 20° |
| No-Go slope limit | 20° | 25° | 30° |

Standard is `DEFAULT_SETTINGS`, unchanged. The other two are round numbers either side of it, chosen
for this project so that the same route can be compared under stricter and looser limits. Every other
setting stays at its default. A link records a preset as `p=` only when it is not Standard, so a link
with no `p`, including every older link, means Standard. Copy link always includes it. The address
bar keeps a preset only if it came in on a link, and no preset is ever stored, so a fresh load opens
on Standard.

## 15. Safest route

In `js/pathfind.js`, using the slope grid from section 12. The search is standard A*. Its cost,
1 + (slope / caution limit) squared per metre, is an ASSUMPTION chosen for this project. It only
picks between routes that are already within the limit. The result then gets the standard report.

## 16. Credits used in layer attribution

CTX: NASA/JPL/MSSS. HiRISE: NASA/JPL/University of Arizona. THEMIS: NASA/JPL/ASU.
MOLA: NASA/GSFC. HRSC: ESA/DLR/FU Berlin.

These are the short credits shown in the map's attribution. For THEMIS, the full credit line asked
for by the THEMIS terms page is NASA/JPL-Caltech/Arizona State University (see section 22).

## 17. Play the walk

`js/walk.js` adds no data. Every value it shows comes from `measureRoute` and `steepSections` in
`js/report.js`, and `tests/walk.test.mjs` checks that its last frame equals the report's totals.

| On screen | Where it comes from |
| --- | --- |
| Distance covered | `d` on each report sample, ending on the one-way distance |
| Time outside | The running walk times `measureRoute` keeps on each sample as it adds up its totals, then the science time, ending on Total time outside |
| Elevation here, Slope here | `z` and `slopeDeg` on each report sample, the same values as the elevation profile |
| Steepest so far | The report's own steepest-slope rule, stopped at the walker's position |
| Steep section | `steepSections`, using the limits in section 10 |

ASSUMPTION: the replay puts the science time at the far end, and says so while it plays. The report
counts that time but does not say when it happens, so another placement would not change any total.
The walk back retraces the same ground, as the report's walk back time already does.

The speed is a playback rate, not data: at 1x, 4 minutes of the walk pass each second.

## 18. Turn-back point

`turnBackPoint` in `js/report.js` adds no data. It walks the report's own samples and takes the last
one where the time out to that sample, plus the time back from it, plus the science time, is within
the time budget. The time out and back are the running times `measureRoute` keeps while adding up
its totals, from the rescaled Tobler model in section 8, with the grade flipped for the way back.
Exactly at the budget fits, the same as the verdict rule. It runs only on the 40 m report grid.
`tests/turnback.test.mjs` checks it against a separate calculation.

| On screen | Where it comes from |
| --- | --- |
| Turn back by here | The last fitting sample, so it is accurate to the sampling interval, 50 m by default |
| Time to spare, in the report line | The time budget minus Total time outside |
| Speed, in Play the walk | The length of each route step over the report's time for that step, which is the walking model's speed there |

The time budget stays the one control. It is an ASSUMPTION, a placeholder of up to 24 hours, not a
NASA value, and Standard stays at 8 hours.

Limits of the model: speed depends only on slope. There is no fatigue, suit mass or Mars-gravity
effect on walking speed, and the app holds no oxygen, power or fatigue values. A stretch with no
elevation data uses the flat-ground speed, as the report does. In Play the walk a shortened walk
spends the science time at the turn-back point, an ASSUMPTION that does not change the total.

## 19. Reachable science

`js/reach.js` adds no data. For each stop it runs `measureRoute` and `decideVerdict` on the straight
route from the base. If that route goes over the No-Go slope limit or off the data, it runs
`findRoute` and judges the result with the same report. Exactly at a limit passes. Stop coordinates
come from section 7: NASA's waypoint feed, or `m20_heli_waypoints.json` for Wright Brothers Field.

| On screen | Where it comes from |
| --- | --- |
| SLOPE | Whether the straight route, or else the search, stays under the No-Go slope limit |
| TIME | Whether Total time outside fits the time budget, as in the turn-back point, section 18 |
| Report | `decideVerdict` on that route. This can differ from SLOPE and TIME, for example a CAUTION for a thin time reserve |

The slope limits and time budget are ASSUMPTIONS, not NASA's rover or suit limits. The safest route
guarantees slope only. The summary line is counted from the results.

## 20. The rover path by slope

| Item | Value |
| --- | --- |
| Source | https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json, NASA/JPL "Where is Perseverance?" map data |
| Accessed | 2026-11-14, stopped at sol 2022, the last sol in `data/rover_traverse.json` |
| Content | 559 legs, 35,010 points, sols 14 to 2022, 46.75 km along the line. Rover odometry says 45.25 km |
| Built by | `tools/build_rover_slopes.mjs`, which writes `data/rover_slopes.json`: 936 steps, 12 KB, 5.7 KB compressed |

Each step is 50 m along the full-resolution line, the report's sampling interval, and its slope is the
rise over that distance on the report's 40 m elevation surface, using `slopeFromRise`. `slopeClass`
then applies the active limits, as the verdict does. Slope only: no time or EVA rule applies. The
limits are ASSUMPTIONS, not NASA's rover or suit limits. Separate Python code, sharing nothing with
the app, read the raw feed and the raw grid and reproduced the shares and the steepest step.

Results depend on step length, and the page says so. Slopes are measured over the 40 m grid, so steeper
local ground can be smoothed out. Measured point to point, about 1 m apart, the line reads 30.4° at
38.99 km and 0.01% over 25°. A step that short on a 40 m grid mostly shows the heading of that metre,
which is why the step is the report's. It is the same comparison the map cannot show, because a 40 m
cell has one slope for a line crossing it in any direction.

## 21. Software shipped with the site

Leaflet 1.9.4, in `vendor/leaflet/`, is the only third-party code the page runs. It is released
under the BSD 2-Clause License, and its `LICENSE` file is published beside it.
Source: https://leafletjs.com, https://github.com/Leaflet/Leaflet/releases/tag/v1.9.4

`leaflet.min.js` and `leaflet.min.css` are the cdnjs 1.9.4 files the site used before, unchanged.
Both match the sha512 integrity hashes the page already named, and `tests/release.test.mjs` checks
that on every run. The images match the `leaflet@1.9.4` npm package byte for byte, and `LICENSE`
comes from that package.

NASA Trek is the only outside host the page needs at runtime, for map tiles. Opening the conditions
panel also asks mars.nasa.gov for the feed in section 6, and the panel works without it. `sw.js` still names
the old cdnjs address, only so a page saved before this change can use the Leaflet copy it cached.

## 22. Licences, terms and credit lines

Each third-party material, its terms as stated on the source's own page, and the credit line used.
"Verified" means the terms were read on that page on the date given. "Checked" means the source's
own pages were read on that date and state no separate licence, or state one that does not clearly
cover what is used here; the entry says what the pages do say, with their URLs. The facts and
numbers taken from articles and pages are cited in the sections above; this table covers terms.

| Material | Used for | Terms or licence | Credit line | Status |
|---|---|---|---|---|
| Leaflet 1.9.4 | Map library | BSD 2-Clause License. Copy in `vendor/leaflet/LICENSE`. https://raw.githubusercontent.com/Leaflet/Leaflet/v1.9.4/LICENSE | Leaflet, Volodymyr Agafonkin and CloudMade | Verified  |
| NASA content in general (MOLA, NSSDC fact sheet, NASA and JPL pages, rover data) | Layers, constants, cited facts | NASA content is generally not subject to copyright in the United States and may be used for educational or informational purposes, including web pages. NASA should be acknowledged, and use must not imply endorsement. https://www.nasa.gov/nasa-brand-center/images-and-media/ | NASA | Verified  |
| JPL images and pages (PIA24750, JPL news releases) | Cited facts | Images on JPL public sites may be used without prior permission, with a credit line and no implied endorsement. https://www.jpl.nasa.gov/jpl-image-use-policy | NASA/JPL-Caltech | Verified (the page refuses automated fetches) |
| NASA Mars Trek tile service and catalogue | Map tiles, layer records | No separate licence stated on https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=mars ; the page carries only "© 2016 Trek" and says nothing about reuse. The Trek home page https://trek.nasa.gov/ links only to NASA privacy and feedback, with no terms page. NASA's media guidelines in the NASA row apply to NASA content. | NASA Trek | Checked : no Trek terms stated |
| CTX imagery (Mars Reconnaissance Orbiter) | Base map | Individuals and schools may reproduce images for non-commercial purposes without express permission, with credit. Commercial use needs written permission from MSSS. https://www.msss.com/policies/index.html | NASA/JPL/MSSS | Verified  |
| HiRISE imagery (Mars Reconnaissance Orbiter) | Overlay | Public domain, no restrictions on use. A credit line is requested. https://www.uahirise.org/media/usage.php | NASA/JPL/University of Arizona | Verified |
| THEMIS day and night infrared (Mars Odyssey) | Overlays | ASU's THEMIS FAQ, https://themis-data.mars.asu.edu/node/2 , says "All THEMIS images on the website are in the public domain", with credit requested. The terms page https://themis.asu.edu/terms states no licence and asks news and educational users to credit NASA/JPL-Caltech/Arizona State University. | NASA/JPL-Caltech/Arizona State University | Verified |
| MOLA shaded relief (Mars Global Surveyor) | Base map | NASA content, see the NASA row. | NASA/GSFC | Verified (NASA guidelines) |
| HRSC elevation in the MOLA + HRSC blend (Mars Express) | Base map | DLR states HRSC images are under CC BY-SA 3.0 IGO, credit "ESA/DLR/FU Berlin, CC BY-SA 3.0 IGO": "This licence applies to all HRSC images released to date." https://www.dlr.de/en/research-and-transfer/projects-and-missions/mars-express/data-and-scientific-objectives (see also https://www.dlr.de/en/blog/archive/2014/simpler-usage-rights-as-of-today-mars-express-hrsc-images-licensed-under-creative-commons-licence , 18 Dec 2014). FU Berlin says the licence applies "where expressly stated". None of these pages names elevation (DEM) products, which is what the blend uses. | ESA/DLR/FU Berlin | Checked: licence stated for images; DEM not named |
| USGS Mars 2020 CTX DEM mosaic (20 m) | Elevation grid, every slope | USGS-authored or produced data and information are in the U.S. public domain. https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits | USGS Astrogeology Science Center | Verified |
| Hydrous mineral detections (OMEGA, CRISM), Trek feature layer | Mineral points | No separate licence stated on https://trek.nasa.gov/mars/trekarcgis/rest/services/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0 ; its "Copyright Text" and "Description" fields are empty (also empty in the service JSON). | OMEGA: ESA/IAS. CRISM: NASA/JHU-APL | Checked : no licence stated |
| Perseverance traverse and waypoints (NASA "Where is Perseverance?" map data) | Rover path, elevation comparison, stops | No separate licence stated on https://science.nasa.gov/mission/mars-2020-perseverance/location-map/ ; the page credits base-map imagery (HiRISE, ESA Mars Express) and links to NASA's brand and usage guidelines. The data file https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_waypoints.json has no licence or credit field in the part read. NASA's media guidelines apply to NASA content. | NASA/JPL-Caltech | Checked : no licence stated |
| Perseverance sample sites (NASA sample map and pages) | Science stops | NASA content, see the NASA row. https://science.nasa.gov/resource/a-map-of-perseverances-samples/ | NASA/JPL-Caltech | Verified  (NASA guidelines) |
| MEDA measurements, Rodriguez-Manfredi et al. 2023, Nature Geoscience | Conditions | Open access under a Creative Commons Attribution 4.0 International License. https://www.nature.com/articles/s41561-022-01084-0 | Rodriguez-Manfredi et al. (2023), Nature Geoscience | Verified  |
| MEDA archive at the PDS Atmospheres Node | Conditions source | No separate licence stated on https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/ or its readme.txt. PDS asks users to "give credit to those who prepared, curated, and archived the data" and to cite the bundle: https://pds.nasa.gov/datastandards/citing/ | NASA PDS, MEDA team | Checked: no licence stated; citation asked |
| Curiosity REMS weather feed (mars.nasa.gov) | Latest reading in conditions | No licence stated in https://mars.nasa.gov/rss/api/?feed=weather&category=msl&feedtype=json . Its own disclaimer says the data comes from Centro de Astrobiologia (CAB) and "is intended for outreach purposes only. Any other use is discouraged." It points to PDS for scientific REMS data. | NASA/JPL-Caltech, REMS team | Checked : outreach-only disclaimer |
| RAD surface radiation (JPL news release) | Conditions | JPL page, see the JPL row. | NASA/JPL-Caltech | Verified  |
| Herd et al., LPSC 2023 (NASA Technical Reports Server) | Cited facts | NTRS lists distribution as public and notes that portions may include copyright-protected material. https://ntrs.nasa.gov/citations/20230000371 | Herd et al. (2023) | Verified |
| Tobler hiking function, Tobler (1993) | Walking speed model (a formula, cited) | No separate licence stated in the report PDF https://escholarship.org/content/qt05r820mz/qt05r820mz.pdf : its cover gives title, author, date and permalink only. The item page https://escholarship.org/uc/item/05r820mz could not be read (HTTP 202 and 403). Only the formula is used, with a citation. | Tobler, W. (1993) | Checked : no licence stated |

### Materials by origin

This table only sorts the materials above by where they come from. The licence status is copied
from the table above; it draws no conclusion about any material.

| Material | Origin | Licence status (from the table above) |
|---|---|---|
| NASA content in general (MOLA, NSSDC fact sheet, NASA and JPL pages, rover data) | NASA | Verified  |
| JPL images and pages (PIA24750, JPL news releases) | NASA | Verified |
| NASA Mars Trek tile service and catalogue | NASA | Checked : no Trek terms stated |
| CTX imagery (Mars Reconnaissance Orbiter) | NASA (terms set by MSSS) | Verified  |
| HiRISE imagery (Mars Reconnaissance Orbiter) | NASA (terms set by the University of Arizona) | Verified |
| THEMIS day and night infrared (Mars Odyssey) | NASA (terms set by ASU) | Verified |
| MOLA shaded relief (Mars Global Surveyor) | NASA | Verified  (NASA guidelines) |
| HRSC elevation in the MOLA + HRSC blend (Mars Express) | Space agency partner: ESA | Checked : DLR's CC BY-SA 3.0 IGO statement covers "all HRSC images"; the pages don't say whether it covers the elevation data the app uses |
| Hydrous mineral detections, Trek feature layer | CRISM: NASA. OMEGA: space agency partner, ESA | Checked : no licence stated |
| Perseverance traverse and waypoints | NASA | Checked : no licence stated |
| Perseverance sample sites | NASA | Verified  (NASA guidelines) |
| MEDA archive at the PDS Atmospheres Node | NASA (Planetary Data System) | Checked : no licence stated; citation asked |
| Curiosity REMS weather feed | NASA (mars.nasa.gov; the feed says its data is provided by Centro de Astrobiologia) | Checked : outreach-only disclaimer |
| RAD surface radiation (JPL news release) | NASA | Verified  |
| Herd et al., LPSC 2023 (NASA Technical Reports Server) | NASA (NTRS) | Verified |
| MEDA measurements, Rodriguez-Manfredi et al. 2023, Nature Geoscience | Other: journal article | Verified (CC BY 4.0) |
| USGS Mars 2020 CTX DEM mosaic (20 m) | Other: USGS elevation data | Verified  |
| Leaflet 1.9.4 | Other: BSD 2-Clause software | Verified  |
| Tobler hiking function, Tobler (1993) | Other: a published formula, cited | Checked : no licence stated |

The project's own code and text are under the Apache License 2.0 (see `LICENSE` and `NOTICE`). That
licence does not cover any of the materials above.


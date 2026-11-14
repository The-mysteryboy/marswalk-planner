// Map layer configuration. One object per layer, so adding a layer means adding
// one entry. Every value here comes from the layer's WMTS GetCapabilities file,
// recorded in SOURCES.md and tools/layer_check_results.json.
import { ASSETS } from './assets.js';

const TREK = 'https://trek.nasa.gov/tiles/Mars/EQ';
const trekUrl = (product, ext) => `${TREK}/${product}/1.0.0/default/default028mm/{z}/{y}/{x}.${ext}`;
const trekCapabilities = (product) => `${TREK}/${product}/1.0.0/WMTSCapabilities.xml`;

function trek({ product, ext, ...rest }) {
  return { kind: 'tile', url: trekUrl(product, ext), source_url: trekCapabilities(product), product, ...rest };
}

const WHOLE_MAP = [[-90, -180], [90, 180]];

// A small local copy of the CTX mosaic, from tools/build_underlay.py. Bounds are
// the exact edges of the zoom 9 tile grid. They live here, not in a data file,
// so the first thing painted never waits for a download.
export const UNDERLAY = {
  // A 128 px copy of the image, small enough to live in the code, so the map is never
  // black while the real image downloads. Printed by tools/build_underlay.py.
  placeholder: 'data:image/webp;base64,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',
  image: ASSETS['jezero_underlay.webp'],
  bounds: [[17.578125, 76.2890625], [19.3359375, 78.75]],
};

export const BASE_LAYERS = [
  trek({
    id: 'ctx',
    label: 'CTX imagery (Mars Reconnaissance Orbiter)',
    mission: 'Mars Reconnaissance Orbiter',
    instrument: 'CTX',
    note: 'Visible-light mosaic around Jezero, up to about 10 m per pixel.',
    resolution: 'About 10 m per pixel as served here. The CTX camera reaches 6 m per pixel.',
    shows: 'A black-and-white visible-light mosaic of the ground around Jezero.',
    why: 'CTX gives the wide view around the narrower HiRISE images, and the elevation model behind every slope in the report was made from CTX stereo images.',
    key: 'Black-and-white image, so there is no colour scale.',
    source_name: 'NASA Trek product record',
    product: 'Jezero_CTX_BlockAdj_dd',
    ext: 'png',
    maxNativeZoom: 12,
    bounds: [[15.9058484, 75.1537692], [19.4453003, 78.8717121]],
    attribution: 'CTX: NASA/JPL/MSSS, NASA Trek',
  }),
  trek({
    id: 'blend',
    label: 'MOLA + HRSC shaded elevation (Mars Global Surveyor, Mars Express)',
    mission: 'Mars Global Surveyor and Mars Express',
    instrument: 'MOLA and HRSC',
    note: 'Colour hillshade blended at 200 m per pixel.',
    resolution: '200 m per pixel.',
    shows: 'A colour hillshade blending terrain models from the MOLA laser altimeter and the HRSC stereo camera.',
    why: 'A hillshade makes the shape of the land easy to see. It is far coarser than the 40 m grid, so the report does not use it.',
    key: 'Colour hillshade. NASA Trek publishes no colour scale for it here, so use Check a point for real heights.',
    source_name: 'NASA Trek product record',
    product: 'Mars_MOLA_blend200ppx_HRSC_ClrShade_clon0dd_200mpp_lzw',
    ext: 'jpg',
    maxNativeZoom: 8,
    bounds: WHOLE_MAP,
    attribution: 'MOLA: NASA/GSFC. HRSC: ESA/DLR/FU Berlin. NASA Trek',
  }),
  trek({
    id: 'mola',
    label: 'MOLA elevation (Mars Global Surveyor)',
    mission: 'Mars Global Surveyor',
    instrument: 'MOLA',
    note: 'Global laser altimeter colour hillshade, 463 m per pixel.',
    resolution: '463 m per pixel.',
    shows: 'A colour hillshade of heights from MOLA, which timed laser pulses reflected from the surface. It uses more than 600 million measurements from 1999 to 2001.',
    why: 'A hillshade makes the shape of the land easy to see. It is far coarser than the 40 m grid, so the report does not use it.',
    key: 'Colour hillshade. NASA Trek publishes no colour scale for it here, so use Check a point for real heights.',
    source_name: 'NASA Trek product record',
    product: 'Mars_MGS_MOLA_ClrShade_merge_global_463m',
    ext: 'jpg',
    maxNativeZoom: 7,
    bounds: WHOLE_MAP,
    attribution: 'MOLA: NASA/GSFC, NASA Trek',
  }),
];

export const TILE_OVERLAYS = [
  trek({
    id: 'hirise',
    label: 'HiRISE imagery (Mars Reconnaissance Orbiter)',
    mission: 'Mars Reconnaissance Orbiter',
    instrument: 'HiRISE',
    note: 'Sharpest view, 25 cm per pixel, west side of the crater only. Zoom in to see it.',
    resolution: '25 cm per pixel, west side of the crater only.',
    shows: "The sharpest orbital mosaic here, made to support Perseverance's landing.",
    why: 'NASA mapped surface hazards for the landing on this mosaic. Its pixels are 160 times finer than the 40 m slope grid, so it shows ground detail the report cannot see.',
    key: 'Orbital image, so there is no colour scale.',
    source_name: 'NASA Trek product record',
    product: 'JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first_dd',
    ext: 'png',
    maxNativeZoom: 17,
    bounds: [[18.3067994, 77.2229331], [18.669315, 77.583964]],
    attribution: 'HiRISE: NASA/JPL/UArizona, NASA Trek',
    opacity: 1,
    defaultOn: false,
  }),
  trek({
    id: 'ctx6',
    label: 'CTX controlled mosaic (Mars Reconnaissance Orbiter)',
    mission: 'Mars Reconnaissance Orbiter',
    instrument: 'CTX',
    note: 'Sharper 6 m per pixel mosaic of the landing area and delta.',
    resolution: 'About 6 m per pixel.',
    shows: 'A black-and-white visible-light mosaic of the landing area and delta, corrected using terrain models from CTX stereo images.',
    why: "This is the map Perseverance's landing system carried to work out where it was during descent.",
    key: 'Black-and-white image, so there is no colour scale.',
    source_name: 'NASA Trek product record',
    product: 'JEZ_ctx_B_soc_008_orthoMosaic_6m_Eqc_latTs0_lon0',
    ext: 'png',
    maxNativeZoom: 13,
    bounds: [[18.2110274, 77.1604655], [18.7211945, 77.6991776]],
    attribution: 'CTX: NASA/JPL/MSSS, NASA Trek',
    opacity: 1,
    defaultOn: false,
  }),
  trek({
    id: 'themisDay',
    label: 'THEMIS day infrared (Mars Odyssey)',
    mission: 'Mars Odyssey',
    instrument: 'THEMIS',
    note: 'Emphasizes topography: warmer sunward slopes are brighter than shaded slopes.',
    resolution: '100 m per pixel.',
    shows: 'Daytime infrared. Warmer sunward slopes are brighter than cooler shaded slopes.',
    why: 'It emphasizes topography, so it gives a view of the slopes that does not depend on the elevation grid.',
    key: 'Brighter is warmer, darker is cooler. No temperature scale is given here.',
    source_name: 'NASA Trek product record',
    product: 'THEMIS_DayIR_ControlledMosaics_100m_v2_oct2018',
    ext: 'png',
    maxNativeZoom: 9,
    bounds: [[-65.0006576, -179.9999997], [65.0007535, 179.9998849]],
    attribution: 'THEMIS: NASA/JPL/ASU, NASA Trek',
    opacity: 0.8,
    defaultOn: false,
  }),
  trek({
    id: 'themisNight',
    label: 'THEMIS night infrared (Mars Odyssey)',
    mission: 'Mars Odyssey',
    instrument: 'THEMIS',
    note: 'Emphasizes differences in thermal inertia, a clue to surface physical properties.',
    resolution: '100 m per pixel.',
    shows: 'Nighttime infrared. It emphasizes differences in thermal inertia between areas.',
    why: 'Thermal inertia gives insight into the physical character of a surface, which is the ground a walker would cross.',
    key: 'Brightness differences mark thermal inertia differences. No numeric scale is given here.',
    source_name: 'NASA Trek product record',
    product: 'THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018',
    ext: 'png',
    maxNativeZoom: 9,
    bounds: [[-65.0006576, -179.9999997], [65.0007535, 179.9998849]],
    attribution: 'THEMIS: NASA/JPL/ASU, NASA Trek',
    opacity: 0.8,
    defaultOn: false,
  }),
];

// Built in the browser from the 40 m report grid, never from a download or the preview.
export const COMPUTED_OVERLAYS = [
  {
    id: 'slope',
    kind: 'computed',
    label: 'Slope map (from the 40 m elevation grid)',
    mission: 'Mars Reconnaissance Orbiter',
    instrument: 'CTX stereo elevation model',
    note: 'Steepest slope in each 40 m cell, coloured with the limits under Assumptions.',
    resolution: '40 m per cell: the same grid behind every report.',
    shows: 'The steepest slope anywhere in each 40 m grid cell.',
    why: 'It shows where a route could fail a slope check before you draw it. A route that stays on green cannot fail one. Yellow or red ground can still pass if the route crosses it at a gentle angle, because the report measures along your route.',
    key: 'Green: up to the caution limit. Yellow: over the caution limit. Red: over the No-Go limit. No colour: no elevation data. This shows slope only. Time and data checks are in the report.',
    source_url: 'https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic',
    source_name: 'USGS Mars 2020 CTX DEM mosaic',
    opacity: 0.55,
    defaultOn: false,
    swatch: 'slope',
  },
];

// Vector overlays are drawn by main.js from local copies in data/. Each file is
// fetched only when its layer is switched on. Stops are always fetched, because
// the report needs them even while their markers are hidden.
export const VECTOR_OVERLAYS = [
  {
    id: 'rover',
    kind: 'vector',
    label: 'Perseverance traverse (Mars 2020)',
    mission: 'Mars 2020',
    instrument: 'Rover localization',
    note: 'Where the rover actually drove, sols 13 to 2022.',
    resolution: 'Drawn at one point per 10 m. Display only: no report uses it.',
    shows: 'Where Perseverance actually drove, from sol 13 to sol 2022.',
    why: "The report's elevation grid was compared with 708 points on Perseverance's route (about 3 m typical difference, 3.1 m RMS), the rover waypoints from this same NASA feed: RMS difference 3.084 m.",
    key: 'White dashed line.',
    source_url: 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json',
    source_name: 'NASA/JPL Perseverance traverse',
    file: ASSETS['rover_traverse.json'],
    defaultOn: true,
    swatch: 'rover',
  },
  {
    id: 'stops',
    kind: 'vector',
    label: 'Science stops (Mars 2020)',
    mission: 'Mars 2020',
    instrument: 'Various, listed per stop',
    note: 'Named Perseverance targets, placed from NASA rover positions.',
    resolution: "Each position is the rover's last fix before the sample was sealed, so it marks the area, not the exact outcrop.",
    shows: 'Nine named Perseverance sites, each with a sourced reason it matters.',
    why: 'The report lists every stop within the stop search distance of your route.',
    key: 'White diamond. Orange when near your route.',
    source_url: 'https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/',
    source_name: 'NASA Mars rock samples',
    file: ASSETS['science_stops.json'],
    defaultOn: true,
    swatch: 'stop',
  },
  {
    id: 'hydrous',
    kind: 'vector',
    label: 'CRISM mineral detections (Mars Reconnaissance Orbiter)',
    mission: 'Mars Reconnaissance Orbiter and Mars Express',
    instrument: 'CRISM and OMEGA',
    note: 'Hydrous mineral detection points. A coarse catalog, not a mineral map.',
    resolution: 'A coarse catalog of points, 11 in this area. Not a mineral map.',
    shows: 'Places where CRISM or OMEGA detected hydrous minerals, such as clays and hydrated salts.',
    why: 'These minerals preserve a record of early environments where liquid water altered the crust.',
    key: 'Blue dot.',
    source_url: 'https://trek.nasa.gov/mars/trekarcgis/rest/services/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0',
    source_name: 'NASA Trek hydrous mineral layer',
    file: ASSETS['hydrous_minerals.json'],
    defaultOn: false,
    swatch: 'hydrous',
  },
];

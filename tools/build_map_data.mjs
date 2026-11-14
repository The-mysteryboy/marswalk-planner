#!/usr/bin/env node
// Builds the local copies of NASA feeds used by the map, so the app never
// depends on undocumented endpoints at runtime.
//   node tools/build_map_data.mjs
// Writes data/rover_traverse.json, data/hydrous_minerals.json, data/science_stops.json
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const M20 = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json';
const WAYPOINTS_URL = `${M20}/M20_waypoints.json`;
const TRAVERSE_URL = `${M20}/M20_traverse.json`;
const HELI_URL = `${M20}/m20_heli_waypoints.json`;
const HYDROUS_URL = 'https://trek.nasa.gov/mars/trekarcgis/rest/services/Hydrous_Mineral_Detections_OMEGA_CRISM_clon0/MapServer/0';
const SAMPLES_URL = 'https://science.nasa.gov/mission/mars-2020-perseverance/mars-rock-samples/';
const ACCESSED = '2026-11-14';

const out = (name) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const save = (name, value) => {
  const text = JSON.stringify(value);
  writeFileSync(out(name), text);
  console.log(`wrote data/${name}: ${(text.length / 1024).toFixed(0)} KB`);
};

async function json(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'MarswalkPlanner-build/1.0' }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

const round = (v, dp) => Number(v.toFixed(dp));
const rad = Math.PI / 180;
// Same radius as js/route.js. Used only to thin the traverse and report offsets.
function metres(a, b) {
  const x = (b[0] - a[0]) * rad * Math.cos(a[1] * rad);
  const y = (b[1] - a[1]) * rad;
  return Math.hypot(x, y) * 3389500;
}

// --- Traverse: one MultiLineString, thinned to one vertex per 10 m or more -----
const traverse = await json(TRAVERSE_URL);
let vertices = 0;
const lines = traverse.features.map((f) => {
  const coords = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
  return coords.map((line) => {
    const kept = [line[0]];
    for (const p of line.slice(1, -1)) if (metres(kept.at(-1), p) >= 10) kept.push(p);
    kept.push(line.at(-1));
    vertices += kept.length;
    return kept.map((p) => [round(p[0], 6), round(p[1], 6)]);
  });
}).flat();

const waypoints = (await json(WAYPOINTS_URL)).features.map((f) => f.properties);
const first = waypoints[0];
const last = waypoints.at(-1);
save('rover_traverse.json', {
  type: 'Feature',
  geometry: { type: 'MultiLineString', coordinates: lines },
  properties: {
    name: traverse.name,
    sols: [first.sol, last.sol],
    total_km: last.dist_km,
    source: { name: 'NASA/JPL Where is Perseverance? map data', url: TRAVERSE_URL, accessed: ACCESSED },
  },
});
console.log(`  ${traverse.features.length} legs, ${vertices} vertices, sols ${first.sol}-${last.sol}, ${last.dist_km} km`);

// --- CRISM / OMEGA hydrous detections around Jezero ---------------------------
const params = new URLSearchParams({
  where: '1=1', geometry: '75,16,80,21', geometryType: 'esriGeometryEnvelope', inSR: '4326',
  spatialRel: 'esriSpatialRelIntersects', outFields: 'Type,Instrument', returnGeometry: 'true', outSR: '4326', f: 'geojson',
});
const hydrous = await json(`${HYDROUS_URL}/query?${params}`);
save('hydrous_minerals.json', {
  type: 'FeatureCollection',
  features: hydrous.features.map((f) => ({
    type: 'Feature',
    geometry: { type: 'Point', coordinates: f.geometry.coordinates.map((c) => round(c, 4)) },
    properties: { type: f.properties.Type, instrument: f.properties.Instrument },
  })),
  source: { name: 'Hydrous Mineral Detections (OMEGA, CRISM), NASA Mars Trek', url: HYDROUS_URL, accessed: ACCESSED },
});
console.log(`  ${hydrous.features.length} detections`);

// --- Science stops ------------------------------------------------------------
// Coordinates are never typed in here. Each stop names a sol, and its position
// is the rover's last localized waypoint on or before that sol.
const heli = (await json(HELI_URL)).features.map((f) => f.properties);
const flight1 = heli.find((p) => p.Flight === 1);

function roverOnSol(sol) {
  const before = waypoints.filter((w) => w.sol <= sol);
  if (before.length === 0) throw new Error(`No waypoint on or before sol ${sol}`);
  return before.at(-1);
}

const PERSEVERANCE = 'Mars 2020 (Perseverance)';
const stops = [
  {
    id: 'oeb', name: 'Octavia E. Butler Landing', sol: first.sol, category: 'Landing site',
    why: 'Where Perseverance began its mission on Mars, on the floor of Jezero Crater.',
    mission: PERSEVERANCE, instrument: 'Rover localization',
    source_name: 'NASA/JPL, Perseverance drives on Mars terrain for first time',
    source_url: 'https://www.jpl.nasa.gov/news/nasas-perseverance-drives-on-mars-terrain-for-first-time/',
  },
  {
    id: 'wbf', name: 'Wright Brothers Field', category: 'Technology',
    why: 'Ingenuity flew here first, making this the first of many airfields on other worlds.',
    mission: 'Mars 2020 (Ingenuity helicopter)', instrument: 'Helicopter navigation',
    source_name: 'NASA/JPL, Ingenuity succeeds in historic first flight',
    source_url: 'https://www.jpl.nasa.gov/news/nasas-ingenuity-mars-helicopter-succeeds-in-historic-first-flight/',
    position: { lat: flight1.Lat, lon: flight1.Lon, sol: flight1.Sol, feed: HELI_URL, note: `Ingenuity position, flight 1, sol ${flight1.Sol}` },
  },
  {
    id: 'rochette', name: 'Rochette (Citadelle)', sol: 194, category: 'Igneous rock',
    why: 'First rock cores of the mission, igneous samples Montdenier and Montagnac from the crater floor.',
    mission: PERSEVERANCE, instrument: 'Sampling system',
    source_name: 'NASA/JPL, Perseverance\'s journey to first successful sample collection',
    source_url: 'https://www.jpl.nasa.gov/images/pia24750-perseverances-journey-to-first-successful-sample-collection/',
  },
  {
    id: 'brac', name: 'Brac (Seitah)', sol: 262, category: 'Crater floor',
    why: 'Second sample pair, Salette and Coulettes, from the crater floor region called Seitah.',
    mission: PERSEVERANCE, instrument: 'Sampling system',
    source_name: 'NASA Science, To Seitah and Back',
    source_url: 'https://science.nasa.gov/missions/mars-2020-perseverance/to-seitah-and-back',
  },
  {
    id: 'skinner', name: 'Skinner Ridge', sol: 490, category: 'Delta sediments',
    why: 'Layered delta rocks, including sandstone with grains carried in from far outside the crater.',
    mission: PERSEVERANCE, instrument: 'Sampling system',
    source_name: 'NASA, Perseverance investigates geologically rich Mars terrain',
    source_url: 'https://www.nasa.gov/news-release/nasas-perseverance-rover-investigates-geologically-rich-mars-terrain/',
  },
  {
    id: 'wildcat', name: 'Wildcat Ridge', sol: 509, category: 'Delta sediments',
    why: 'Delta mudstone where SHERLOC registered the most abundant organic detections of the mission to that date.',
    mission: PERSEVERANCE, instrument: 'SHERLOC',
    source_name: 'NASA, Perseverance investigates geologically rich Mars terrain',
    source_url: 'https://www.nasa.gov/news-release/nasas-perseverance-rover-investigates-geologically-rich-mars-terrain/',
  },
  {
    id: 'threeforks', name: 'Three Forks Sample Depot', sol: 653, category: 'Sample depot',
    why: 'Perseverance\'s first depot: 10 sample tubes selected to be left on the surface here.',
    mission: PERSEVERANCE, instrument: 'Sampling system',
    source_name: 'NASA Science, A map of Perseverance\'s samples',
    source_url: 'https://science.nasa.gov/resource/a-map-of-perseverances-samples/',
  },
  {
    id: 'cometgeyser', name: 'Comet Geyser (Bunsen Peak)', sol: 1088, category: 'Carbonate rock',
    why: 'Sample 24, a rock core that NASA\'s sample table lists as a silica-cemented carbonate.',
    mission: PERSEVERANCE, instrument: 'Sampling system',
    source_name: 'NASA Science, Mars Rock Samples',
    source_url: SAMPLES_URL,
  },
  {
    id: 'cheyava', name: 'Cheyava Falls (Bright Angel)', sol: 1215, category: 'Potential biosignature',
    why: 'Source of the Sapphire Canyon core, which contains potential biosignatures. This is not a confirmation of life.',
    mission: PERSEVERANCE, instrument: 'PIXL and SHERLOC',
    source_name: 'NASA/JPL, Mars rover discovered potential biosignature',
    source_url: 'https://www.jpl.nasa.gov/news/nasa-says-mars-rover-discovered-potential-biosignature-last-year/',
  },
];

const resolved = stops.map(({ position, ...s }) => {
  if (position) {
    return { ...s, sol: position.sol, lat: round(position.lat, 6), lon: round(position.lon, 6), coord_source: position.feed, coord_note: position.note };
  }
  const w = roverOnSol(s.sol);
  const next = waypoints.find((x) => x.sol > w.sol);
  const moved = next ? metres([w.lon, w.lat], [next.lon, next.lat]) : 0;
  console.log(`  ${s.name.padEnd(30)} sol ${String(s.sol).padStart(4)} -> waypoint sol ${String(w.sol).padStart(4)}, next waypoint ${moved.toFixed(0)} m away, ${w.lat.toFixed(5)}, ${w.lon.toFixed(5)}`);
  return { ...s, lat: round(w.lat, 6), lon: round(w.lon, 6), coord_source: WAYPOINTS_URL, coord_note: `Rover position on sol ${w.sol}, the last fix on or before sol ${s.sol}. Not the exact outcrop.` };
});
save('science_stops.json', { accessed: ACCESSED, stops: resolved });

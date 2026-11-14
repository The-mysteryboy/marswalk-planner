#!/usr/bin/env node
// Finds the routes used by the scenarios, using the real report engine and default limits.
//   node tools/find_scenarios.mjs
// It prints what it finds. js/scenarios.js holds the results, and tests/scenarios.test.mjs
// checks them, so a scenario's claim can always be reproduced.
import { readFileSync } from 'node:fs';
import { DEFAULT_SETTINGS, decideVerdict, measureRoute, stopsNearRoute } from '../js/report.js';
import { MARS_RADIUS_M, haversineM } from '../js/route.js';
import { terrainFromBytes } from '../js/terrain.js';

const root = new URL('../data/', import.meta.url);
const read = (name) => readFileSync(new URL(name, root));
const index = JSON.parse(read('terrain.json'));
const buf = read(index.full.encoding.file);
const terrain = await terrainFromBytes(index.full, buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length));
const { stops } = JSON.parse(read('science_stops.json'));
const settings = { ...DEFAULT_SETTINGS };
const home = stops.find((s) => s.id === 'oeb');

function verdictOf(points) {
  const m = measureRoute(points, points[0], terrain, settings);
  return { m, level: decideVerdict(m, settings).level };
}

// Destination a given distance along a bearing, on a sphere the size of Mars.
function along(from, bearingDeg, metres) {
  const d = metres / MARS_RADIUS_M;
  const b = (bearingDeg * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lon1 = (from.lon * Math.PI) / 180;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lon2 = lon1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return { lat: (lat2 * 180) / Math.PI, lon: (lon2 * 180) / Math.PI };
}

// Longest straight GO walk from the landing site, every 5 degrees, to the nearest 50 m.
let longest = null;
for (let bearing = 0; bearing < 360; bearing += 5) {
  let reach = 0;
  for (let metres = 500; metres <= 12000; metres += 50) {
    if (verdictOf([home, along(home, bearing, metres)]).level !== 'go') break;
    reach = metres;
  }
  if (reach && (!longest || reach > longest.reach)) longest = { bearing, reach };
}
const end = along(home, longest.bearing, longest.reach);
const out = verdictOf([home, end]);
console.log('Longest straight GO walk:', longest, end, `reserve ${out.m.marginPct.toFixed(1)}%, max slope ${out.m.maxSlopeDeg.toFixed(1)}`);
console.log('  50 m more:', verdictOf([home, along(home, longest.bearing, longest.reach + 50)]).level);

// Every ordered visit of up to five named stops. Keep the GO route near the most stops.
const others = stops.filter((s) => s.id !== 'oeb');
let best = null;
let tried = 0;
function visit(path) {
  if (path.length > 1) {
    tried += 1;
    const { m, level } = verdictOf(path);
    if (level !== 'go') return;
    const near = stopsNearRoute(stops, m.samples, settings.stopRadiusKm).length;
    if (!best || near > best.near || (near === best.near && m.distanceM < best.distanceM)) {
      best = { near, ids: path.map((p) => p.id), distanceM: m.distanceM, reserve: m.marginPct, slope: m.maxSlopeDeg };
    }
  }
  if (path.length === 6) return;
  for (const s of others) {
    if (!path.includes(s) && haversineM(path.at(-1), s) < 9000) visit([...path, s]);
  }
}
visit([home]);
console.log(`Most stops on a GO route, of ${tried} tried:`, best);

// Named stops seen from the landing site, for the delta-front scenario.
for (const id of ['threeforks', 'wildcat', 'skinner']) {
  const { m, level } = verdictOf([home, stops.find((s) => s.id === id)]);
  console.log(`Straight to ${id}:`, level, `${(m.distanceM / 1000).toFixed(2)} km, slope ${m.maxSlopeDeg.toFixed(1)}, reserve ${m.marginPct.toFixed(0)}%`);
}

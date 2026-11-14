#!/usr/bin/env node
// Writes data/rover_slopes.json: Perseverance's recorded path as 50 m steps, each with
// its slope, so the page can class it under any assumed limits without the elevation grid.
//   node tools/build_rover_slopes.mjs [saved M20_traverse.json]
//
// It reads NASA's full-resolution line, not the thinned line the map draws, and stops at
// the last sol in data/rover_traverse.json, so a newer feed cannot change these results.
// A step spans the report's sampling interval, measured along the rover's own line, and
// its slope uses the report's elevation surface and slopeFromRise. The line's points sit
// about 1 m apart, far shorter than one 40 m grid cell, so the slope of each small step
// says more about the heading of that metre than the ground. The figure at every point
// is still worked out and kept in the file, so the page can state it.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEFAULT_SETTINGS, measureRoute } from '../js/report.js';
import { haversineM, interpolate } from '../js/route.js';
import { slopeFromRise } from '../js/terrain.js';
import { loadRealTerrain } from '../tests/helpers.mjs';

const TRAVERSE_URL = 'https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json';
const ACCESSED = '2026-11-14';
const SCALE = 1e6;     // Stored positions: a millionth of a degree is about 6 cm here.
const SLOPE_SCALE = 100;

const dataFile = (name) => fileURLToPath(new URL(`../data/${name}`, import.meta.url));
const local = JSON.parse(readFileSync(dataFile('rover_traverse.json'), 'utf8')).properties;
const lastSol = local.sols[1];

const saved = process.argv[2];
const raw = saved ? JSON.parse(readFileSync(saved, 'utf8')) : await (await fetch(TRAVERSE_URL)).json();
const legs = raw.features.filter((f) => f.properties.sol <= lastSol);

// Every leg in order, as one line. A leg starts where the last one ended.
const line = [];
for (const leg of legs) {
  const parts = leg.geometry.type === 'LineString' ? [leg.geometry.coordinates] : leg.geometry.coordinates;
  for (const part of parts) {
    for (const [lon, lat] of part) {
      const last = line.at(-1);
      if (!last || last.lat !== lat || last.lon !== lon) line.push({ lat, lon });
    }
  }
}

const stepM = DEFAULT_SETTINGS.sampleStepM;
const round = (p) => ({ lat: Math.round(p.lat * SCALE) / SCALE, lon: Math.round(p.lon * SCALE) / SCALE });

// One point every stepM along the line, however its vertices fall.
const points = [round(line[0])];
let left = stepM;
for (let i = 1; i < line.length; i++) {
  const a = line[i - 1];
  const b = line[i];
  const length = haversineM(a, b);
  let along = 0;
  while (length - along >= left) {
    along += left;
    points.push(round(interpolate(a, b, along / length)));
    left = stepM;
  }
  left -= length - along;
}
const lastRunM = stepM - left;
if (lastRunM > 0) points.push(round(line.at(-1)));

const terrain = await loadRealTerrain('full');
const heights = points.map((p) => terrain.elevationAt(p.lat, p.lon));
if (heights.includes(null)) throw new Error('The rover path leaves the elevation grid.');
const slopes = [];
for (let i = 1; i < points.length; i++) {
  const run = i === points.length - 1 && lastRunM > 0 ? lastRunM : stepM;
  slopes.push(Math.round(slopeFromRise(heights[i] - heights[i - 1], run) * SLOPE_SCALE));
}

const deltas = (key) => points.map((p, i) => Math.round((p[key] - (i ? points[i - 1][key] : 0)) * SCALE));
const fine = measureRoute(line, line[0], terrain, DEFAULT_SETTINGS);
const totalM = (points.length - 2) * stepM + (lastRunM > 0 ? lastRunM : stepM);

writeFileSync(dataFile('rover_slopes.json'), `${JSON.stringify({
  source: { name: 'NASA/JPL Where is Perseverance? map data', url: TRAVERSE_URL, accessed: ACCESSED },
  sols: [legs[0].properties.sol, lastSol],
  vertices: line.length,
  odometerKm: local.total_km,
  stepM,
  lastRunM: Number(lastRunM.toFixed(3)),
  totalM: Number(totalM.toFixed(1)),
  scale: SCALE,
  slopeScale: SLOPE_SCALE,
  everyPoint: { maxDeg: Number(fine.maxSlopeDeg.toFixed(2)), atM: Math.round(fine.maxSlopeAtM) },
  lat: deltas('lat'),
  lon: deltas('lon'),
  slope: slopes,
})}\n`);

console.log(`${legs.length} legs, ${line.length} vertices, ${(totalM / 1000).toFixed(2)} km, ${slopes.length} steps`);
console.log(`Steepest step ${Math.max(...slopes) / SLOPE_SCALE}°. At every point: ${fine.maxSlopeDeg.toFixed(2)}° at ${(fine.maxSlopeAtM / 1000).toFixed(3)} km`);
